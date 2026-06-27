import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "operador" | "cliente";

export const ADMIN_EMAIL = "contato@protenexus.com";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

// ============================================================================
// Acesso direto via REST (PostgREST/GoTrue) para evitar @supabase/supabase-js,
// que exige WebSocket nativo e quebra no Node 20 em self-host. Toda a leitura e
// escrita do painel administrativo passa por aqui.
// ============================================================================

function restBase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuração do servidor incompleta.");
  return { url: url.replace(/\/$/, ""), key };
}

function tryRestBase(): { url: string; key: string } | null {
  try {
    return restBase();
  } catch {
    return null;
  }
}

function authHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` } as Record<string, string>;
}

async function fetchWithTimeout(input: URL | string, init: RequestInit, ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function restSelect<T = any>(
  base: { url: string; key: string },
  table: string,
  query: Record<string, string> = {},
  label = table,
  ms = 3000,
): Promise<T[]> {
  try {
    const endpoint = new URL(`${base.url}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(query)) endpoint.searchParams.set(k, v);
    const res = await fetchWithTimeout(endpoint, { headers: authHeaders(base.key) }, ms);
    if (!res.ok) {
      console.error(`restSelect ${label}: status ${res.status}`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json) ? (json as T[]) : [];
  } catch (error) {
    console.error(`restSelect ${label}: falhou`, error);
    return [];
  }
}

async function restWrite(
  base: { url: string; key: string },
  table: string,
  init: RequestInit & { query?: Record<string, string> },
) {
  const endpoint = new URL(`${base.url}/rest/v1/${table}`);
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

async function restUpsert(
  base: { url: string; key: string },
  table: string,
  body: any,
  onConflict: string,
) {
  return restWrite(base, table, {
    method: "POST",
    query: { on_conflict: onConflict },
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
}

// ---- GoTrue admin via REST -------------------------------------------------

async function authGetUserById(base: { url: string; key: string }, userId: string): Promise<any | null> {
  try {
    const res = await fetchWithTimeout(
      `${base.url}/auth/v1/admin/users/${userId}`,
      { headers: authHeaders(base.key) },
      2_500,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("authGetUserById: falhou", error);
    return null;
  }
}

async function authListUsers(base: { url: string; key: string }): Promise<any[]> {
  const users: any[] = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const url = new URL(`${base.url}/auth/v1/admin/users`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "1000");
      const res = await fetchWithTimeout(url, { headers: authHeaders(base.key) }, 2_500);
      if (!res.ok) break;
      const json = await res.json();
      const pageUsers = Array.isArray(json?.users) ? json.users : Array.isArray(json) ? json : [];
      users.push(...pageUsers);
      if (pageUsers.length < 1000) break;
    } catch (error) {
      console.error("authListUsers: falhou", error);
      break;
    }
  }
  return users;
}

// ---- helpers de e-mail / claims -------------------------------------------

function decodeJwtEmail() {
  try {
    const authHeader = getRequestHeader("authorization") ?? getRequestHeader("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const payload = token.split(".")[1];
    if (!payload) return "";
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded =
      typeof globalThis.atob === "function"
        ? globalThis.atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(decoded);
    return normalizeEmail(claims?.email ?? claims?.user_email);
  } catch {
    return "";
  }
}

function getAuthEmail(claims: unknown) {
  const direct = normalizeEmail((claims as any)?.email ?? (claims as any)?.user_email);
  return direct || decodeJwtEmail();
}

async function resolveEmail(
  base: { url: string; key: string },
  userId: string,
  hint?: string,
): Promise<string> {
  const fromHint = normalizeEmail(hint);
  if (fromHint) return fromHint;
  const user = await authGetUserById(base, userId);
  return normalizeEmail(user?.email);
}

/**
 * Fonte única de verdade para os papéis do usuário.
 * Garante (auto-reparo) que o admin padrão — ou o primeiro usuário de uma
 * instalação nova/local sem nenhum admin — receba o papel "admin".
 */
async function resolveRoles(
  base: { url: string; key: string },
  userId: string,
  emailHint?: string,
): Promise<AppRole[]> {
  const rows = await restSelect<{ role: AppRole }>(
    base,
    "user_roles",
    { select: "role", user_id: `eq.${userId}` },
    "user_roles (resolveRoles)",
  );
  let roles = rows.map((r) => r.role as AppRole);
  if (roles.includes("admin")) return roles;

  if (roles.length > 0 && !(roles.length === 1 && roles[0] === "cliente")) {
    return roles;
  }

  const email = await resolveEmail(base, userId, emailHint);
  const isDefaultAdminEmail = email === ADMIN_EMAIL;

  let shouldPromote = isDefaultAdminEmail;
  if (!shouldPromote) {
    const admins = await restSelect(
      base,
      "user_roles",
      { select: "user_id", role: "eq.admin", limit: "1" },
      "user_roles (count admins)",
    );
    shouldPromote = admins.length === 0;
  }
  if (!shouldPromote) return roles;

  try {
    await restUpsert(
      base,
      "profiles",
      {
        id: userId,
        email: email || null,
        ...(isDefaultAdminEmail ? { nome: "Administrador" } : {}),
        updated_at: new Date().toISOString(),
      },
      "id",
    );
    await restUpsert(base, "user_roles", { user_id: userId, role: "admin" }, "user_id,role");
    await restWrite(base, "user_roles", {
      method: "DELETE",
      query: { user_id: `eq.${userId}`, role: "eq.cliente" },
    });
    roles = ["admin"];
  } catch (err) {
    console.error("resolveRoles: falha ao promover admin", err);
  }
  return roles;
}

async function assertStaff(base: { url: string; key: string }, userId: string, emailHint?: string) {
  const email = normalizeEmail(emailHint);

  if (email === ADMIN_EMAIL) {
    try {
      const roles = await resolveRoles(base, userId, email);
      return Array.from(new Set([...roles, "admin"])) as AppRole[];
    } catch {
      return ["admin"] as AppRole[];
    }
  }

  const roles = await resolveRoles(base, userId, emailHint);
  if (!roles.includes("admin") && !roles.includes("operador")) {
    throw new Error("Acesso restrito");
  }
  return roles;
}

// ============================================================================
// Server functions
// ============================================================================

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const emailClaim = getAuthEmail(claims);
    const isDefaultAdmin = emailClaim === ADMIN_EMAIL;
    const base = tryRestBase();

    let roles: AppRole[] = [];
    let sub: { plano: string; status: string; periodo_fim: string | null } | null = null;
    if (base) {
      try {
        roles = await resolveRoles(base, userId, emailClaim);
      } catch (err) {
        console.error("getMyAccess: falha ao resolver papéis", err);
      }
      const subs = await restSelect<any>(
        base,
        "subscriptions",
        {
          select: "plano, status, periodo_fim",
          user_id: `eq.${userId}`,
          order: "created_at.desc",
          limit: "1",
        },
        "subscriptions (getMyAccess)",
      );
      sub = subs[0] ?? null;
    }

    const isAdmin = roles.includes("admin") || isDefaultAdmin;
    const isStaff = isAdmin || roles.includes("operador");
    if (isAdmin && !roles.includes("admin")) roles = [...roles, "admin"];

    const ativo =
      sub?.status === "ativo" &&
      (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());

    const plano: "start" | "pro" | "elite" | null = isStaff
      ? "elite"
      : ativo
        ? (sub!.plano as "start" | "pro" | "elite")
        : null;

    return {
      roles,
      isAdmin,
      isStaff,
      plano,
      status: isStaff ? "ativo" : sub?.status ?? null,
    };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const emailClaim = getAuthEmail(claims);
    const base = tryRestBase();

    let nome: string | null = null;
    let email: string | null = emailClaim || null;
    if (base) {
      const rows = await restSelect<any>(
        base,
        "profiles",
        { select: "nome, email", id: `eq.${userId}`, limit: "1" },
        "profiles (getMyProfile)",
      );
      nome = rows[0]?.nome ?? null;
      email = email || rows[0]?.email || null;
      if (!email) email = await resolveEmail(base, userId);
    }
    return { nome, email };
  });

export const updateMyName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { nome: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const base = restBase();
    await restUpsert(
      base,
      "profiles",
      { id: userId, nome: data.nome.trim() || null, updated_at: new Date().toISOString() },
      "id",
    );
    return { ok: true };
  });

export const listClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    let currentEmail = getAuthEmail(claims);
    let requesterRoles: AppRole[] = [];

    if (!currentEmail) {
      currentEmail = await resolveEmail(base, userId);
    }

    if (currentEmail !== ADMIN_EMAIL) {
      requesterRoles = await assertStaff(base, userId, currentEmail);
      if (!requesterRoles.includes("admin") && !requesterRoles.includes("operador")) {
        throw new Error("Acesso restrito");
      }
    } else {
      requesterRoles = ["admin"];
    }
    if (currentEmail === ADMIN_EMAIL && !requesterRoles.includes("admin")) {
      requesterRoles = Array.from(new Set([...requesterRoles, "admin"]));
    }

    const [profiles, roles, subs] = await Promise.all([
      restSelect<any>(base, "profiles", { select: "*" }, "profiles (listClientes)"),
      restSelect<any>(base, "user_roles", { select: "user_id, role" }, "user_roles (listClientes)"),
      restSelect<any>(
        base,
        "subscriptions",
        { select: "user_id, plano, status, periodo_fim" },
        "subscriptions (listClientes)",
      ),
    ]);

    const roleMap = new Map<string, string[]>();
    for (const r of roles) {
      if (!r.user_id) continue;
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }
    if (requesterRoles.length > 0) {
      roleMap.set(userId, Array.from(new Set([...(roleMap.get(userId) ?? []), ...requesterRoles])));
    }
    const subMap = new Map<string, any>();
    for (const s of subs) if (s.user_id) subMap.set(s.user_id, s);

    const byId = new Map<string, any>();
    for (const p of profiles) if (p.id) byId.set(p.id, p);

    const ensureUserRow = (id: string, fallback: Partial<any> = {}) => {
      if (!id || byId.has(id)) return;
      byId.set(id, {
        id,
        nome: fallback.nome ?? null,
        email: fallback.email ?? null,
        cpf: fallback.cpf ?? null,
        data_nascimento: fallback.data_nascimento ?? null,
        created_at: fallback.created_at ?? new Date().toISOString(),
      });
    };

    ensureUserRow(userId, {
      nome: currentEmail === ADMIN_EMAIL || requesterRoles.includes("admin") ? "Administrador" : null,
      email: currentEmail || null,
    });
    for (const id of roleMap.keys()) ensureUserRow(id);
    for (const id of subMap.keys()) ensureUserRow(id);

    // Completa quem tem conta no Auth mas perdeu o profile/role (self-host).
    try {
      const authUsers = await authListUsers(base);
      for (const u of authUsers) {
        if (!u?.id) continue;
        const existing = byId.get(u.id);
        if (existing) {
          existing.email = existing.email ?? u.email ?? null;
          existing.nome =
            existing.nome ?? u.user_metadata?.nome ?? u.user_metadata?.full_name ?? null;
          existing.cpf = existing.cpf ?? u.user_metadata?.cpf ?? null;
          existing.data_nascimento =
            existing.data_nascimento ?? u.user_metadata?.data_nascimento ?? null;
          continue;
        }
        byId.set(u.id, {
          id: u.id,
          nome: u.user_metadata?.nome ?? u.user_metadata?.full_name ?? null,
          email: u.email ?? null,
          cpf: u.user_metadata?.cpf ?? null,
          data_nascimento: u.user_metadata?.data_nascimento ?? null,
          created_at: u.created_at ?? new Date().toISOString(),
        });
        if (normalizeEmail(u.email) === ADMIN_EMAIL) {
          roleMap.set(u.id, Array.from(new Set([...(roleMap.get(u.id) ?? []), "admin"])));
        }
      }
    } catch (error) {
      console.error("listClientes: falha ao listar usuários no Auth", error);
    }

    // Garante que o admin padrão sempre apareça.
    const existingAdmin = Array.from(byId.values()).find(
      (p) => normalizeEmail(p.email) === ADMIN_EMAIL,
    );
    if (existingAdmin) {
      roleMap.set(
        existingAdmin.id,
        Array.from(new Set([...(roleMap.get(existingAdmin.id) ?? []), "admin"])),
      );
      existingAdmin.nome = existingAdmin.nome || "Administrador";
      existingAdmin.email = ADMIN_EMAIL;
    } else if (currentEmail === ADMIN_EMAIL || requesterRoles.includes("admin")) {
      byId.set(userId, {
        id: userId,
        nome: "Administrador",
        email: currentEmail || ADMIN_EMAIL,
        cpf: null,
        data_nascimento: null,
        created_at: new Date().toISOString(),
      });
      roleMap.set(userId, ["admin"]);
    }

    return Array.from(byId.values()).map((p) => ({
      id: p.id,
      nome: normalizeEmail(p.email) === ADMIN_EMAIL ? "Administrador" : p.nome,
      email: normalizeEmail(p.email) === ADMIN_EMAIL ? ADMIN_EMAIL : p.email,
      cpf: (p as any).cpf ?? null,
      data_nascimento: (p as any).data_nascimento ?? null,
      created_at: p.created_at,
      roles:
        normalizeEmail(p.email) === ADMIN_EMAIL
          ? Array.from(new Set([...(roleMap.get(p.id) ?? []), "admin"]))
          : roleMap.get(p.id) ?? [],
      plano: normalizeEmail(p.email) === ADMIN_EMAIL ? "elite" : subMap.get(p.id)?.plano ?? null,
      status: normalizeEmail(p.email) === ADMIN_EMAIL ? "ativo" : subMap.get(p.id)?.status ?? "inativo",
    }));
  });

export const updateClienteProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      clienteId: string;
      nome: string;
      email: string;
      cpf: string;
      data_nascimento: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertStaff(base, userId, getAuthEmail(claims));

    const fullPayload = {
      nome: data.nome.trim() || null,
      email: data.email.trim() || null,
      cpf: data.cpf.replace(/\D/g, "") || null,
      data_nascimento: data.data_nascimento || null,
      updated_at: new Date().toISOString(),
    };
    try {
      await restWrite(base, "profiles", {
        method: "PATCH",
        query: { id: `eq.${data.clienteId}` },
        body: JSON.stringify(fullPayload),
      });
    } catch (error) {
      console.error("updateClienteProfile: retry sem campos novos", error);
      await restWrite(base, "profiles", {
        method: "PATCH",
        query: { id: `eq.${data.clienteId}` },
        body: JSON.stringify({
          nome: data.nome.trim() || null,
          email: data.email.trim() || null,
          updated_at: new Date().toISOString(),
        }),
      });
    }
    return { ok: true };
  });

export const setClientePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clienteId: string; senha: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    const roles = await assertStaff(base, userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Apenas admin pode alterar senha");
    if (!data.senha || data.senha.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");

    const res = await fetch(`${base.url}/auth/v1/admin/users/${data.clienteId}`, {
      method: "PUT",
      headers: { ...authHeaders(base.key), "Content-Type": "application/json" },
      body: JSON.stringify({ password: data.senha }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Erro ${res.status}`);
    }
    return { ok: true };
  });

export const setClientePlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { clienteId: string; plano: string; status: "ativo" | "inativo" }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    await assertStaff(base, userId, getAuthEmail(claims));

    await restUpsert(
      base,
      "subscriptions",
      {
        user_id: data.clienteId,
        plano: data.plano,
        status: data.status,
        updated_at: new Date().toISOString(),
      },
      "user_id",
    );
    return { ok: true };
  });

export const createCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      nome: string;
      email: string;
      senha: string;
      cpf?: string;
      data_nascimento?: string | null;
      plano: string;
      status: "ativo" | "inativo";
      isAdmin?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    const roles = await assertStaff(base, userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Apenas admin pode criar usuários");
    if (!data.email.trim()) throw new Error("Informe um e-mail");
    if (!data.senha || data.senha.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");

    const createRes = await fetch(`${base.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { ...authHeaders(base.key), "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.email.trim(),
        password: data.senha,
        email_confirm: true,
        user_metadata: {
          nome: data.nome.trim(),
          cpf: (data.cpf ?? "").replace(/\D/g, ""),
          data_nascimento: data.data_nascimento || "",
        },
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      throw new Error(text || `Erro ${createRes.status}`);
    }
    const created = await createRes.json();
    const newId = created?.id ?? created?.user?.id;
    if (!newId) throw new Error("Não foi possível criar o usuário.");

    const cpf = (data.cpf ?? "").replace(/\D/g, "") || null;
    try {
      await restUpsert(
        base,
        "profiles",
        {
          id: newId,
          nome: data.nome.trim() || null,
          email: data.email.trim() || null,
          cpf,
          data_nascimento: data.data_nascimento || null,
          updated_at: new Date().toISOString(),
        },
        "id",
      );
    } catch (error) {
      console.error("createCliente: retry perfil sem campos novos", error);
      try {
        await restUpsert(
          base,
          "profiles",
          {
            id: newId,
            nome: data.nome.trim() || null,
            email: data.email.trim() || null,
            updated_at: new Date().toISOString(),
          },
          "id",
        );
      } catch (err) {
        console.error("createCliente: falha ao criar perfil", err);
      }
    }

    if (data.isAdmin) {
      await restUpsert(base, "user_roles", { user_id: newId, role: "admin" }, "user_id,role");
      await restWrite(base, "user_roles", {
        method: "DELETE",
        query: { user_id: `eq.${newId}`, role: "eq.cliente" },
      }).catch((e) => console.error("createCliente: limpar cliente", e));
    } else {
      await restUpsert(base, "user_roles", { user_id: newId, role: "cliente" }, "user_id,role");
      await restUpsert(
        base,
        "subscriptions",
        {
          user_id: newId,
          plano: data.plano,
          status: data.status,
          updated_at: new Date().toISOString(),
        },
        "user_id",
      );
    }

    return { ok: true, id: newId };
  });

export const getClientStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    const currentEmail = getAuthEmail(claims);
    if (currentEmail !== ADMIN_EMAIL) {
      const roles = await assertStaff(base, userId, currentEmail);
      if (!roles.includes("admin") && !roles.includes("operador")) {
        throw new Error("Acesso restrito");
      }
    }

    const [profiles, roles, subs, planoCfg] = await Promise.all([
      restSelect<any>(base, "profiles", { select: "id, created_at" }, "profiles (stats)"),
      restSelect<any>(base, "user_roles", { select: "user_id, role" }, "user_roles (stats)"),
      restSelect<any>(
        base,
        "subscriptions",
        { select: "user_id, plano, status, periodo_fim, created_at" },
        "subscriptions (stats)",
      ),
      restSelect<any>(base, "plano_config", { select: "plano, preco" }, "plano_config (stats)"),
    ]);

    const parsePreco = (v: string | null | undefined) => {
      if (!v) return 0;
      const n = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".");
      return parseFloat(n) || 0;
    };
    const precoMap: Record<string, number> = { start: 29.9, pro: 49.9, elite: 79.9 };
    for (const p of planoCfg) precoMap[p.plano] = parsePreco(p.preco);

    const staffIds = new Set(
      roles
        .filter((r) => r.role === "admin" || r.role === "operador")
        .map((r) => r.user_id),
    );

    const subMap = new Map<string, any>();
    for (const s of subs) subMap.set(s.user_id, s);

    const clientes = profiles.filter((p) => !staffIds.has(p.id));

    const now = new Date();
    const isAtivo = (s: any) =>
      s?.status === "ativo" && (!s?.periodo_fim || new Date(s.periodo_fim) > now);

    const porPlano: Record<string, number> = { start: 0, pro: 0, elite: 0, sem: 0 };
    let ativos = 0;
    for (const c of clientes) {
      const s = subMap.get(c.id);
      if (s && isAtivo(s)) {
        ativos += 1;
        porPlano[s.plano] = (porPlano[s.plano] ?? 0) + 1;
      } else {
        porPlano.sem += 1;
      }
    }

    const meses: { mes: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString("pt-BR", { month: "short" });
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const total = clientes.filter((c) => {
        const cd = new Date(c.created_at);
        return cd >= d && cd < next;
      }).length;
      meses.push({ mes: label, total });
    }

    const clienteIds = new Set(clientes.map((c) => c.id));
    const faturamentoPorMes: { mes: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const ini = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const fim = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = ini.toLocaleDateString("pt-BR", { month: "short" });
      let total = 0;
      for (const s of subs) {
        if (!clienteIds.has(s.user_id)) continue;
        if (s.status !== "ativo") continue;
        const criada = s.created_at ? new Date(s.created_at) : ini;
        if (criada >= fim) continue;
        if (s.periodo_fim && new Date(s.periodo_fim) < ini) continue;
        total += precoMap[s.plano] ?? 0;
      }
      faturamentoPorMes.push({ mes: label, total: Math.round(total * 100) / 100 });
    }

    return {
      totalClientes: clientes.length,
      ativos,
      inativos: clientes.length - ativos,
      porPlano,
      cadastrosPorMes: meses,
      faturamentoPorMes,
    };
  });

export const getSystemConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const base = restBase();
    const roles = await assertStaff(base, userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Acesso restrito");

    return restSelect<any>(
      base,
      "system_config",
      { select: "chave, valor, descricao", order: "chave.asc" },
      "system_config",
    );
  });

export const setSystemConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chave: string; valor: string; descricao?: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const base = restBase();
    const roles = await assertStaff(base, userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Acesso restrito");

    await restUpsert(
      base,
      "system_config",
      {
        chave: data.chave,
        valor: data.valor,
        descricao: data.descricao ?? null,
        updated_at: new Date().toISOString(),
      },
      "chave",
    );
    return { ok: true };
  });
