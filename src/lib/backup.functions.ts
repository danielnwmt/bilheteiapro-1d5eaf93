import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// Backup / Restauração do sistema.
// Salva: bancas (depósitos + entradas), cadastro dos clientes (profiles +
// papéis + assinaturas), chaves de API (system_config) e histórico de
// pagamento (subscriptions). Envia para o Google Drive e permite restaurar.
//
// Usa REST direto (PostgREST/GoTrue) para evitar @supabase/supabase-js, que
// quebra no Node 20 em self-host.
// ============================================================================

const ADMIN_EMAIL = "contato@protenexus.com";

// Tabelas incluídas no backup e a coluna de conflito usada na restauração.
const BACKUP_TABLES: { table: string; onConflict: string }[] = [
  { table: "banca_depositos", onConflict: "id" },
  { table: "banca_entradas", onConflict: "id" },
  { table: "profiles", onConflict: "id" },
  { table: "user_roles", onConflict: "user_id,role" },
  { table: "subscriptions", onConflict: "id" },
  { table: "plano_config", onConflict: "id" },
  { table: "system_config", onConflict: "chave" },
];

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function restBase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuração do servidor incompleta.");
  return { url: url.replace(/\/$/, ""), key };
}

function authHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` } as Record<string, string>;
}

function getAuthEmail(claims: any): string {
  return normalizeEmail(claims?.email ?? claims?.user_metadata?.email);
}

async function assertAdmin(base: { url: string; key: string }, userId: string, email: string) {
  if (email === ADMIN_EMAIL) return;
  const endpoint = new URL(`${base.url}/rest/v1/user_roles`);
  endpoint.searchParams.set("select", "role");
  endpoint.searchParams.set("user_id", `eq.${userId}`);
  const res = await fetch(endpoint, { headers: authHeaders(base.key) });
  const rows = res.ok ? ((await res.json()) as { role: string }[]) : [];
  if (!rows.some((r) => r.role === "admin")) throw new Error("Acesso restrito");
}

async function restSelectAll(base: { url: string; key: string }, table: string) {
  const endpoint = new URL(`${base.url}/rest/v1/${table}`);
  endpoint.searchParams.set("select", "*");
  const res = await fetch(endpoint, { headers: authHeaders(base.key) });
  if (!res.ok) throw new Error(`Falha ao ler ${table}: ${res.status}`);
  return (await res.json()) as any[];
}

async function restUpsert(
  base: { url: string; key: string },
  table: string,
  rows: any[],
  onConflict: string,
) {
  if (!rows.length) return;
  const endpoint = new URL(`${base.url}/rest/v1/${table}`);
  endpoint.searchParams.set("on_conflict", onConflict);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(base.key),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao restaurar ${table}: ${text || res.status}`);
  }
}

export type BackupFile = {
  versao: number;
  geradoEm: string;
  origem: string;
  dados: Record<string, any[]>;
};

// ---- Gerar backup (retorna o JSON para download) ---------------------------
export const createBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const dados: Record<string, any[]> = {};
    for (const { table } of BACKUP_TABLES) {
      dados[table] = await restSelectAll(base, table);
    }

    const backup: BackupFile = {
      versao: 1,
      geradoEm: new Date().toISOString(),
      origem: "BilheteIA",
      dados,
    };
    return backup;
  });

// ---- Restaurar backup ------------------------------------------------------
export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { backup: BackupFile }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const backup = data.backup;
    if (!backup?.dados || typeof backup.dados !== "object") {
      throw new Error("Arquivo de backup inválido.");
    }

    const resultado: Record<string, number> = {};
    for (const { table, onConflict } of BACKUP_TABLES) {
      const rows = Array.isArray(backup.dados[table]) ? backup.dados[table] : [];
      await restUpsert(base, table, rows, onConflict);
      resultado[table] = rows.length;
    }
    return { ok: true, restaurado: resultado };
  });

// ---- Enviar backup para o Google Drive -------------------------------------
export const backupToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const lovableKey = process.env.LOVABLE_API_KEY;
    const driveKey = process.env.GOOGLE_DRIVE_API_KEY;
    if (!lovableKey || !driveKey) {
      throw new Error(
        "Google Drive não está conectado neste servidor. Use 'Baixar backup' ou conecte o Drive.",
      );
    }

    const dados: Record<string, any[]> = {};
    for (const { table } of BACKUP_TABLES) {
      dados[table] = await restSelectAll(base, table);
    }
    const backup: BackupFile = {
      versao: 1,
      geradoEm: new Date().toISOString(),
      origem: "BilheteIA",
      dados,
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `bilheteia-backup-${stamp}.json`;
    const content = JSON.stringify(backup, null, 2);

    const boundary = "----bilheteia" + Math.random().toString(16).slice(2);
    const metadata = { name: filename, mimeType: "application/json" };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const res = await fetch(
      "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": driveKey,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Falha ao enviar para o Drive: ${text || res.status}`);
    }
    const out = (await res.json()) as { id?: string; name?: string };
    return { ok: true, fileId: out.id, filename: out.name ?? filename };
  });
