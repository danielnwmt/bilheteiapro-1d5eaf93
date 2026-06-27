import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// Backup / Restauração do sistema.
// Salva: bancas (depósitos + entradas), cadastro dos clientes (profiles +
// papéis + assinaturas), planos (plano_config), chaves de API (system_config)
// e histórico de pagamento (subscriptions). Envia ao Google Drive e restaura.
//
// Drive: suporta OAuth próprio (self-host, 100% local) guardando o refresh
// token em system_config. Se não houver, cai no conector da Lovable.
//
// Usa REST direto (PostgREST/GoTrue) para evitar @supabase/supabase-js, que
// quebra no Node 20 em self-host.
// ============================================================================

const ADMIN_EMAIL = "contato@protenexus.com";

// Chaves usadas em system_config para o OAuth do Google Drive.
const CFG_CLIENT_ID = "gdrive_client_id";
const CFG_CLIENT_SECRET = "gdrive_client_secret";
const CFG_REFRESH_TOKEN = "gdrive_refresh_token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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

// ---- Helpers de system_config (config do Drive) ----------------------------
async function cfgGet(base: { url: string; key: string }, chave: string): Promise<string | null> {
  const endpoint = new URL(`${base.url}/rest/v1/system_config`);
  endpoint.searchParams.set("select", "valor");
  endpoint.searchParams.set("chave", `eq.${chave}`);
  const res = await fetch(endpoint, { headers: authHeaders(base.key) });
  if (!res.ok) return null;
  const rows = (await res.json()) as { valor: string | null }[];
  return rows[0]?.valor ?? null;
}

async function cfgSet(base: { url: string; key: string }, chave: string, valor: string) {
  const endpoint = new URL(`${base.url}/rest/v1/system_config`);
  endpoint.searchParams.set("on_conflict", "chave");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...authHeaders(base.key),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ chave, valor, updated_at: new Date().toISOString() }]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao salvar configuração: ${text || res.status}`);
  }
}

async function cfgDelete(base: { url: string; key: string }, chave: string) {
  const endpoint = new URL(`${base.url}/rest/v1/system_config`);
  endpoint.searchParams.set("chave", `eq.${chave}`);
  await fetch(endpoint, { method: "DELETE", headers: authHeaders(base.key) });
}

// Troca o refresh token por um access token válido.
async function getDriveAccessToken(base: { url: string; key: string }): Promise<string | null> {
  const clientId = await cfgGet(base, CFG_CLIENT_ID);
  const clientSecret = await cfgGet(base, CFG_CLIENT_SECRET);
  const refreshToken = await cfgGet(base, CFG_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha na autenticação com o Google Drive: ${text || res.status}`);
  }
  const out = (await res.json()) as { access_token?: string };
  return out.access_token ?? null;
}

// Upload multipart genérico para o Drive (com access token próprio).
async function uploadToDriveOAuth(accessToken: string, filename: string, content: string) {
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
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao enviar para o Drive: ${text || res.status}`);
  }
  return (await res.json()) as { id?: string; name?: string };
}

export type BackupFile = {
  versao: number;
  geradoEm: string;
  origem: string;
  dados: Record<string, any[]>;
};

async function montarBackup(base: { url: string; key: string }): Promise<BackupFile> {
  const dados: Record<string, any[]> = {};
  for (const { table } of BACKUP_TABLES) {
    dados[table] = await restSelectAll(base, table);
  }
  return { versao: 1, geradoEm: new Date().toISOString(), origem: "BilheteIA", dados };
}

// ---- Status / configuração do Google Drive ---------------------------------
export const getDriveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const clientId = await cfgGet(base, CFG_CLIENT_ID);
    const clientSecret = await cfgGet(base, CFG_CLIENT_SECRET);
    const refreshToken = await cfgGet(base, CFG_REFRESH_TOKEN);
    const lovableReady = Boolean(process.env.LOVABLE_API_KEY && process.env.GOOGLE_DRIVE_API_KEY);

    return {
      hasCredentials: Boolean(clientId && clientSecret),
      connected: Boolean(clientId && clientSecret && refreshToken),
      lovableReady,
    };
  });

// Salva Client ID + Secret do Google.
export const saveDriveCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string; clientSecret: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const clientId = data.clientId?.trim();
    const clientSecret = data.clientSecret?.trim();
    if (!clientId || !clientSecret) throw new Error("Informe o Client ID e o Client Secret.");

    await cfgSet(base, CFG_CLIENT_ID, clientId);
    await cfgSet(base, CFG_CLIENT_SECRET, clientSecret);
    return { ok: true };
  });

// Monta a URL de consentimento do Google.
export const getDriveAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { redirectUri: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const clientId = await cfgGet(base, CFG_CLIENT_ID);
    if (!clientId) throw new Error("Salve o Client ID e o Client Secret primeiro.");

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", data.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DRIVE_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return { url: url.toString() };
  });

// Troca o código de autorização pelo refresh token e guarda.
export const exchangeDriveCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string; redirectUri: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    const clientId = await cfgGet(base, CFG_CLIENT_ID);
    const clientSecret = await cfgGet(base, CFG_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new Error("Credenciais do Google não configuradas.");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: data.code,
        redirect_uri: data.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Falha ao conectar o Drive: ${text || res.status}`);
    }
    const out = (await res.json()) as { refresh_token?: string };
    if (!out.refresh_token) {
      throw new Error(
        "O Google não retornou um refresh token. Remova o acesso do app na sua conta Google e conecte novamente.",
      );
    }
    await cfgSet(base, CFG_REFRESH_TOKEN, out.refresh_token);
    return { ok: true };
  });

// Desconecta o Drive (remove o refresh token).
export const disconnectDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));
    await cfgDelete(base, CFG_REFRESH_TOKEN);
    return { ok: true };
  });

// ---- Gerar backup (retorna o JSON para download) ---------------------------
export const createBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));
    return montarBackup(base);
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
// Executa o backup e envia ao Drive (OAuth próprio ou conector Lovable).
async function performDriveBackup(base: { url: string; key: string }) {
  const backup = await montarBackup(base);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `bilheteia-backup-${stamp}.json`;
  const content = JSON.stringify(backup, null, 2);

  // 1) OAuth próprio (self-host / 100% local)
  const accessToken = await getDriveAccessToken(base);
  if (accessToken) {
    const out = await uploadToDriveOAuth(accessToken, filename, content);
    return { ok: true, fileId: out.id, filename: out.name ?? filename, via: "oauth" };
  }

  // 2) Conector da Lovable (fallback)
  const lovableKey = process.env.LOVABLE_API_KEY;
  const driveKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!lovableKey || !driveKey) {
    throw new Error(
      "Google Drive não está conectado. Conecte sua conta Google ou use 'Baixar backup'.",
    );
  }

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
  return { ok: true, fileId: out.id, filename: out.name ?? filename, via: "lovable" };
}

// ---- Enviar backup para o Google Drive (manual) ----------------------------
export const backupToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));
    return performDriveBackup(base);
  });

// ============================================================================
// Backup automático agendado
// ============================================================================
const CFG_AUTO_ENABLED = "backup_auto_enabled";
const CFG_AUTO_TIME = "backup_auto_time"; // "HH:MM" no horário de Brasília
const CFG_AUTO_FREQ = "backup_auto_freq"; // "daily" | "weekly"
const CFG_AUTO_WEEKDAY = "backup_auto_weekday"; // 0 (dom) .. 6 (sáb)
const CFG_AUTO_LAST = "backup_auto_last"; // ISO do último envio automático

export type BackupSchedule = {
  enabled: boolean;
  time: string;
  freq: "daily" | "weekly";
  weekday: number;
  lastRun: string | null;
};

// Horário atual em Brasília (UTC-3, sem horário de verão).
function brasiliaNow() {
  const now = new Date();
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return {
    hour: br.getUTCHours(),
    minute: br.getUTCMinutes(),
    weekday: br.getUTCDay(),
    dateKey: br.toISOString().slice(0, 10),
    iso: now.toISOString(),
  };
}

export const getBackupSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BackupSchedule> => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));
    return {
      enabled: (await cfgGet(base, CFG_AUTO_ENABLED)) === "1",
      time: (await cfgGet(base, CFG_AUTO_TIME)) ?? "03:00",
      freq: ((await cfgGet(base, CFG_AUTO_FREQ)) as "daily" | "weekly") ?? "daily",
      weekday: Number((await cfgGet(base, CFG_AUTO_WEEKDAY)) ?? "0"),
      lastRun: await cfgGet(base, CFG_AUTO_LAST),
    };
  });

export const saveBackupSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { enabled: boolean; time: string; freq: "daily" | "weekly"; weekday: number }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertAdmin(base, userId, getAuthEmail(claims));

    if (!/^\d{2}:\d{2}$/.test(data.time)) throw new Error("Horário inválido.");
    await cfgSet(base, CFG_AUTO_ENABLED, data.enabled ? "1" : "0");
    await cfgSet(base, CFG_AUTO_TIME, data.time);
    await cfgSet(base, CFG_AUTO_FREQ, data.freq === "weekly" ? "weekly" : "daily");
    await cfgSet(base, CFG_AUTO_WEEKDAY, String(data.weekday ?? 0));
    return { ok: true };
  });

// Chamado pelo cron (endpoint público). Verifica o horário e dispara o envio.
// Não exige auth de usuário — roda com a service role no servidor.
export async function runScheduledBackup(): Promise<{ ran: boolean; reason?: string; result?: any }> {
  const base = restBase();
  if ((await cfgGet(base, CFG_AUTO_ENABLED)) !== "1") return { ran: false, reason: "desativado" };

  const time = (await cfgGet(base, CFG_AUTO_TIME)) ?? "03:00";
  const freq = (await cfgGet(base, CFG_AUTO_FREQ)) ?? "daily";
  const weekday = Number((await cfgGet(base, CFG_AUTO_WEEKDAY)) ?? "0");
  const [h] = time.split(":").map(Number);

  const now = brasiliaNow();
  if (now.hour !== h) return { ran: false, reason: "fora do horário" };
  if (freq === "weekly" && now.weekday !== weekday) return { ran: false, reason: "outro dia" };

  // Evita rodar mais de uma vez no mesmo dia.
  const last = await cfgGet(base, CFG_AUTO_LAST);
  if (last && last.slice(0, 10) === now.dateKey) return { ran: false, reason: "já executado hoje" };

  const result = await performDriveBackup(base);
  await cfgSet(base, CFG_AUTO_LAST, now.iso);
  return { ran: true, result };
}
