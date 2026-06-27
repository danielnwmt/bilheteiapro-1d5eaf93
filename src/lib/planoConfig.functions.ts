import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

const RecursosSchema = z.record(z.string(), z.boolean());

const planoKey = z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, - ou _");

const UpdateSchema = z.object({
  plano: planoKey,
  nome: z.string().min(1).max(120),
  preco: z.string().min(1).max(40),
  descricao: z.string().min(1).max(400),
  historicoDias: z.number().int().min(1).max(365),
  ligas: z.array(z.string()).max(100),
  recursos: RecursosSchema,
  descontoSemestral: z.number().int().min(0).max(100).optional(),
  descontoAnual: z.number().int().min(0).max(100).optional(),
});

const CreateSchema = z.object({
  plano: planoKey,
  nome: z.string().min(1).max(120),
  preco: z.string().min(1).max(40),
  descricao: z.string().max(400).optional(),
  historicoDias: z.number().int().min(1).max(365).optional(),
  ligas: z.array(z.string()).max(100).optional(),
  recursos: RecursosSchema.optional(),
  descontoSemestral: z.number().int().min(0).max(100).optional(),
  descontoAnual: z.number().int().min(0).max(100).optional(),
});

// Acesso direto via REST (PostgREST/GoTrue) para evitar @supabase/supabase-js,
// que exige WebSocket nativo (quebra no Node 20 em self-host).
function restBase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuração do servidor incompleta.");
  return { url: url.replace(/\/$/, ""), key };
}

function authHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` } as Record<string, string>;
}

async function assertAdmin(userId: string, claims: unknown) {
  const { url, key } = restBase();

  // Resolve e-mail do solicitante (claims pode não conter email em self-host).
  let email = String((claims as any)?.email ?? "").trim().toLowerCase();
  if (!email) {
    try {
      const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        headers: authHeaders(key),
      });
      if (res.ok) {
        const u = await res.json();
        email = String(u?.email ?? "").trim().toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }

  let isAdmin = email === ADMIN_EMAIL;
  if (!isAdmin) {
    const endpoint = new URL(`${url}/rest/v1/user_roles`);
    endpoint.searchParams.set("select", "role");
    endpoint.searchParams.set("user_id", `eq.${userId}`);
    endpoint.searchParams.set("role", "eq.admin");
    const res = await fetch(endpoint, { headers: authHeaders(key) });
    if (res.ok) {
      const rows = await res.json();
      isAdmin = Array.isArray(rows) && rows.length > 0;
    }
  }

  if (!isAdmin) throw new Error("Acesso restrito a administradores.");
  return { url, key };
}

async function restRequest(
  base: { url: string; key: string },
  path: string,
  init: RequestInit & { query?: Record<string, string> },
) {
  const endpoint = new URL(`${base.url}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) endpoint.searchParams.set(k, v);
  const res = await fetch(endpoint, {
    ...init,
    headers: {
      ...authHeaders(base.key),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Erro ${res.status}`);
  }
  return res;
}

export const updatePlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const base = await assertAdmin(context.userId, context.claims);
    await restRequest(base, "plano_config", {
      method: "PATCH",
      query: { plano: `eq.${data.plano}` },
      body: JSON.stringify({
        nome: data.nome,
        preco: data.preco,
        descricao: data.descricao,
        historico_dias: data.historicoDias,
        ligas: data.ligas,
        recursos: data.recursos,
        desconto_semestral: data.descontoSemestral ?? 0,
        desconto_anual: data.descontoAnual ?? 0,
      }),
    });
    return { ok: true };
  });

export const createPlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const base = await assertAdmin(context.userId, context.claims);

    // Já existe?
    const existingRes = await fetch(
      `${base.url}/rest/v1/plano_config?select=plano&plano=eq.${encodeURIComponent(data.plano)}`,
      { headers: authHeaders(base.key) },
    );
    const existing = existingRes.ok ? await existingRes.json() : [];
    if (Array.isArray(existing) && existing.length > 0) {
      throw new Error("Já existe um plano com esse identificador.");
    }

    // Próximo nível.
    const maxRes = await fetch(
      `${base.url}/rest/v1/plano_config?select=nivel&order=nivel.desc&limit=1`,
      { headers: authHeaders(base.key) },
    );
    const maxRows = maxRes.ok ? await maxRes.json() : [];
    const nivel = (Array.isArray(maxRows) && maxRows[0]?.nivel ? Number(maxRows[0].nivel) : 0) + 1;

    await restRequest(base, "plano_config", {
      method: "POST",
      body: JSON.stringify({
        plano: data.plano,
        nome: data.nome,
        preco: data.preco,
        descricao: data.descricao ?? "",
        nivel,
        historico_dias: data.historicoDias ?? 15,
        ligas: data.ligas ?? [],
        recursos: data.recursos ?? {},
        desconto_semestral: data.descontoSemestral ?? 0,
        desconto_anual: data.descontoAnual ?? 0,
      }),
    });
    return { ok: true };
  });

export const deletePlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ plano: planoKey }).parse(d))
  .handler(async ({ data, context }) => {
    const base = await assertAdmin(context.userId, context.claims);
    await restRequest(base, "plano_config", {
      method: "DELETE",
      query: { plano: `eq.${data.plano}` },
    });
    return { ok: true };
  });
