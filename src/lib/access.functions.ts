import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "operador" | "cliente";

export const ADMIN_EMAIL = "contato@protenexus.com";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

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

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch((error) => {
    console.error(`${label}: falhou`, error);
    return fallback;
  });

  try {
    return await Promise.race([
      guarded,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => {
          console.error(`${label}: tempo limite atingido`);
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type SupabaseAdmin = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

/**
 * Resolve o e-mail do usuário (claims do token ou Auth).
 */
async function resolveEmail(
  admin: SupabaseAdmin,
  userId: string,
  hint?: string,
): Promise<string> {
  const fromHint = normalizeEmail(hint);
  if (fromHint) return fromHint;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return normalizeEmail(data.user?.email);
  } catch {
    return "";
  }
}

async function safeSelectRows<T>(label: string, query: any): Promise<T[]> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(query),
      2_500,
      { data: [], error: null },
      `leitura ${label}`,
    );
    if (error) {
      console.error(`listClientes: falha ao ler ${label}`, error);
      return [];
    }
    return (data ?? []) as T[];
  } catch (error) {
    console.error(`listClientes: excecao ao ler ${label}`, error);
    return [];
  }
}

async function listAuthUsersDirectly(): Promise<any[]> {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return [];

  const users: any[] = [];
  for (let page = 1; page <= 3; page++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2_500);
    try {
      const url = new URL("/auth/v1/admin/users", baseUrl);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "1000");
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) break;
      const json = await res.json();
      const pageUsers = Array.isArray(json?.users) ? json.users : Array.isArray(json) ? json : [];
      users.push(...pageUsers);
      if (pageUsers.length < 1000) break;
    } catch (error) {
      console.error("listClientes: fallback direto no Auth falhou", error);
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return users;
}

async function listAuthUsersViaRpc(admin: SupabaseAdmin): Promise<any[]> {
  try {
    const { data, error } = await withTimeout(
      Promise.resolve((admin as any).rpc("admin_list_auth_users")),
      2_000,
      { data: [], error: null },
      "fallback RPC auth.users",
    );
    if (error) {
      console.error("listClientes: fallback RPC auth.users falhou", error);
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    return rows.map((u: any) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      user_metadata: u.raw_user_meta_data ?? {},
    }));
  } catch (error) {
    console.error("listClientes: excecao fallback RPC auth.users", error);
    return [];
  }
}

/**
 * Fonte única de verdade para os papéis do usuário.
 * Garante (auto-reparo) que o admin padrão — ou o primeiro usuário de uma
 * instalação nova/local sem nenhum admin — receba o papel "admin".
 * Retorna a lista de papéis já corrigida.
 */
async function resolveRoles(
  admin: SupabaseAdmin,
  userId: string,
  emailHint?: string,
): Promise<AppRole[]> {
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) console.error("resolveRoles: falha ao ler user_roles", error);

  let roles = (data ?? []).map((r) => r.role as AppRole);
  if (roles.includes("admin")) return roles;

  // Só tenta promover quando faz sentido: usuário sem papel ou apenas "cliente".
  if (roles.length > 0 && !(roles.length === 1 && roles[0] === "cliente")) {
    return roles;
  }

  const email = await resolveEmail(admin, userId, emailHint);
  const isDefaultAdminEmail = email === ADMIN_EMAIL;

  let shouldPromote = isDefaultAdminEmail;
  if (!shouldPromote) {
    const { count } = await admin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    shouldPromote = (count ?? 0) === 0;
  }
  if (!shouldPromote) return roles;

  try {
    await admin.from("profiles").upsert(
      {
        id: userId,
        email: email || null,
        ...(isDefaultAdminEmail ? { nome: "Administrador" } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    await admin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
    await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "cliente");
    roles = ["admin"];
  } catch (err) {
    console.error("resolveRoles: falha ao promover admin", err);
  }
  return roles;
}

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const emailClaim = getAuthEmail(claims);
    const isDefaultAdmin = emailClaim === ADMIN_EMAIL;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Papéis do banco (best-effort). Em servidores locais a leitura/escrita pode
    // falhar; por isso o e-mail do admin padrão é a fonte de verdade definitiva.
    let roles: AppRole[] = [];
    try {
      roles = await resolveRoles(supabaseAdmin, userId, emailClaim);
    } catch (err) {
      console.error("getMyAccess: falha ao resolver papéis", err);
    }

    let sub: { plano: string; status: string; periodo_fim: string | null } | null = null;
    try {
      const res = await supabaseAdmin
        .from("subscriptions")
        .select("plano, status, periodo_fim")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sub = (res.data as any) ?? null;
    } catch (err) {
      console.error("getMyAccess: falha ao ler assinatura", err);
    }

    // O admin padrão é SEMPRE admin, mesmo que o banco não tenha o papel.
    const isAdmin = roles.includes("admin") || isDefaultAdmin;
    const isStaff = isAdmin || roles.includes("operador");
    if (isAdmin && !roles.includes("admin")) roles = [...roles, "admin"];

    const ativo =
      sub?.status === "ativo" &&
      (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());

    // Admin/operador têm ACESSO TOTAL: tratamos como plano máximo (elite).
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

async function assertStaff(userId: string, emailHint?: string) {
  const email = normalizeEmail(emailHint);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Admin padrão tem acesso garantido em qualquer ambiente (inclui self-host).
  if (email === ADMIN_EMAIL) {
    try {
      const roles = await resolveRoles(supabaseAdmin, userId, email);
      return Array.from(new Set([...roles, "admin"])) as AppRole[];
    } catch {
      return ["admin"] as AppRole[];
    }
  }

  const roles = await resolveRoles(supabaseAdmin, userId, emailHint);
  if (!roles.includes("admin") && !roles.includes("operador")) {
    throw new Error("Acesso restrito");
  }
  return roles;
}

export const listClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    let currentEmail = getAuthEmail(claims);
    let requesterRoles: AppRole[] = [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!currentEmail) {
      currentEmail = await withTimeout(
        resolveEmail(supabaseAdmin, userId),
        1_500,
        "",
        "resolver email do usuario atual",
      );
    }

    if (currentEmail !== ADMIN_EMAIL) {
      requesterRoles = await withTimeout(
        assertStaff(userId, currentEmail),
        3_000,
        [] as AppRole[],
        "validacao staff listClientes",
      );
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
      // `select("*")` mantém compatibilidade com servidores locais antigos que
      // ainda não tinham cpf/data_nascimento no profiles.
      safeSelectRows<any>("profiles", supabaseAdmin.from("profiles").select("*")),
      safeSelectRows<any>("user_roles", supabaseAdmin.from("user_roles").select("user_id, role")),
      safeSelectRows<any>("subscriptions", supabaseAdmin.from("subscriptions").select("user_id, plano, status, periodo_fim")),
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

    // Indexa os perfis existentes.
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

    // Mesmo que profiles ou Auth Admin falhem no self-host, qualquer usuário com
    // papel ou assinatura ainda aparece no painel.
    ensureUserRow(userId, {
      nome: currentEmail === ADMIN_EMAIL || requesterRoles.includes("admin") ? "Administrador" : null,
      email: currentEmail || null,
    });
    for (const id of roleMap.keys()) ensureUserRow(id);
    for (const id of subMap.keys()) ensureUserRow(id);

    const ensureDefaultAdminVisible = () => {
      const existing = Array.from(byId.values()).find(
        (p) => normalizeEmail(p.email) === ADMIN_EMAIL,
      );
      if (existing) {
        roleMap.set(existing.id, Array.from(new Set([...(roleMap.get(existing.id) ?? []), "admin"])));
        existing.nome = existing.nome || "Administrador";
        existing.email = ADMIN_EMAIL;
        return;
      }

      // Self-host robusto: se Auth/Admin API ou triggers locais falharem,
      // pelo menos o admin logado aparece na tela como administrador geral.
      if (currentEmail === ADMIN_EMAIL || requesterRoles.includes("admin")) {
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
    };

    // Robustez sem travar a tela: usa primeiro os dados públicos já rápidos.
    // Só consulta Auth quando quase não há perfis, com limite curto de tempo.
    if (byId.size <= 1) {
      try {
        const [rpcUsers, directUsers] = await Promise.all([
          withTimeout(listAuthUsersViaRpc(supabaseAdmin), 2_500, [] as any[], "listar usuários via RPC"),
          withTimeout(listAuthUsersDirectly(), 2_500, [] as any[], "listar usuários direto Auth"),
        ]);
        const authUsers: any[] = [];
        const seenAuthIds = new Set<string>();
        for (const u of [...rpcUsers, ...directUsers]) {
          if (!u?.id || seenAuthIds.has(u.id)) continue;
          seenAuthIds.add(u.id);
          authUsers.push(u);
        }
      for (const u of authUsers) {
        const existing = byId.get(u.id);
        if (existing) {
          // Completa campos faltantes do perfil com dados do Auth.
          existing.email = existing.email ?? u.email ?? null;
          existing.nome =
            existing.nome ?? u.user_metadata?.nome ?? u.user_metadata?.full_name ?? null;
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
        console.error("Falha ao listar usuários no Auth", error);
      }
    }

    ensureDefaultAdminVisible();

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
    await assertStaff(userId, getAuthEmail(claims));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let { error } = await supabaseAdmin
      .from("profiles")
      .update({
        nome: data.nome.trim() || null,
        email: data.email.trim() || null,
        cpf: data.cpf.replace(/\D/g, "") || null,
        data_nascimento: data.data_nascimento || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.clienteId);
    if (error) {
      console.error("updateClienteProfile: retry sem campos novos", error);
      const retry = await supabaseAdmin
        .from("profiles")
        .update({
          nome: data.nome.trim() || null,
          email: data.email.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.clienteId);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setClientePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clienteId: string; senha: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const roles = await assertStaff(userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Apenas admin pode alterar senha");
    if (!data.senha || data.senha.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.clienteId, {
      password: data.senha,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setClientePlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { clienteId: string; plano: string; status: "ativo" | "inativo" }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    await assertStaff(userId, getAuthEmail(claims));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: data.clienteId,
        plano: data.plano,
        status: data.status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
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
    const roles = await assertStaff(userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Apenas admin pode criar usuários");
    if (!data.email.trim()) throw new Error("Informe um e-mail");
    if (!data.senha || data.senha.length < 6)
      throw new Error("A senha deve ter ao menos 6 caracteres");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim(),
      password: data.senha,
      email_confirm: true,
      user_metadata: {
        nome: data.nome.trim(),
        cpf: (data.cpf ?? "").replace(/\D/g, ""),
        data_nascimento: data.data_nascimento || "",
      },
    });
    if (error) throw new Error(error.message);
    const newId = created.user!.id;

    const profilePayload =
      {
        id: newId,
        nome: data.nome.trim() || null,
        email: data.email.trim() || null,
        cpf: (data.cpf ?? "").replace(/\D/g, "") || null,
        data_nascimento: data.data_nascimento || null,
        updated_at: new Date().toISOString(),
      };
    let profileResult = await supabaseAdmin.from("profiles").upsert(profilePayload, { onConflict: "id" });
    if (profileResult.error) {
      console.error("createCliente: retry perfil sem campos novos", profileResult.error);
      profileResult = await supabaseAdmin.from("profiles").upsert(
        {
          id: newId,
          nome: data.nome.trim() || null,
          email: data.email.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    }
    if (profileResult.error) console.error("createCliente: falha ao criar perfil", profileResult.error);

    if (data.isAdmin) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: newId, role: "admin" },
        { onConflict: "user_id,role" },
      );
      await supabaseAdmin.from("user_roles").delete().eq("user_id", newId).eq("role", "cliente");
    } else {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: newId, role: "cliente" },
        { onConflict: "user_id,role" },
      );
      await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: newId,
          plano: data.plano,
          status: data.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    }

    return { ok: true, id: newId };
  });


export const getClientStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const currentEmail = getAuthEmail(claims);
    if (currentEmail !== ADMIN_EMAIL) {
      const roles = await withTimeout(
        assertStaff(userId, currentEmail),
        3_000,
        [] as AppRole[],
        "validacao staff dashboard",
      );
      if (!roles.includes("admin") && !roles.includes("operador")) {
        throw new Error("Acesso restrito");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profiles, roles, subs, planoCfg] = await Promise.all([
      safeSelectRows<any>("profiles stats", supabaseAdmin.from("profiles").select("id, created_at")),
      safeSelectRows<any>("user_roles stats", supabaseAdmin.from("user_roles").select("user_id, role")),
      safeSelectRows<any>("subscriptions stats", supabaseAdmin.from("subscriptions").select("user_id, plano, status, periodo_fim, created_at")),
      safeSelectRows<any>("plano_config stats", supabaseAdmin.from("plano_config").select("plano, preco")),
    ]);

    const parsePreco = (v: string | null | undefined) => {
      if (!v) return 0;
      const n = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".");
      return parseFloat(n) || 0;
    };
    const precoMap: Record<string, number> = { start: 29.9, pro: 49.9, elite: 79.9 };
    for (const p of planoCfg) precoMap[p.plano] = parsePreco(p.preco);

    // IDs que são apenas staff (admin/operador) não contam como clientes.
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

    // Cadastros nos últimos 6 meses.
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

    // Faturamento por mês (últimos 6 meses) — assinaturas ativas no período.
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
    const roles = await assertStaff(userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Acesso restrito");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await withTimeout<any>(
      Promise.resolve(
        supabaseAdmin.from("system_config").select("chave, valor, descricao").order("chave"),
      ),
      2_500,
      { data: [], error: null },
      "leitura system_config",
    );
    if (error) {
      console.error("getSystemConfig: falha ao ler configurações", error);
      return [];
    }
    return data ?? [];
  });

export const setSystemConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chave: string; valor: string; descricao?: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const roles = await assertStaff(userId, getAuthEmail(claims));
    if (!roles.includes("admin")) throw new Error("Acesso restrito");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("system_config").upsert(
      {
        chave: data.chave,
        valor: data.valor,
        descricao: data.descricao ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chave" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
