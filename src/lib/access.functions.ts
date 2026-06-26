import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "operador" | "cliente";

const ADMIN_EMAIL = "contato@protenexus.com";

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: userData }, { data: roles }, { data: sub }] = await Promise.all([
      supabaseAdmin.auth.admin.getUserById(userId),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin
        .from("subscriptions")
        .select("plano, status, periodo_fim")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    let accessRoles = (roles ?? []).map((r) => r.role as AppRole);
    let email = String((claims as any)?.email ?? "").trim().toLowerCase();
    if (!email) email = String(userData.user?.email ?? "").trim().toLowerCase();

    // Reparo automático para instalações locais: se o admin padrão entrou mas
    // ficou sem papel, corrige na hora em qualquer carregamento do sistema.
    if (!accessRoles.includes("admin") && (email === ADMIN_EMAIL || accessRoles.length === 0)) {
      try {
        const { count } = await supabaseAdmin
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("role", "admin");

        if (email === ADMIN_EMAIL || (count ?? 0) === 0) {
          await supabaseAdmin.from("profiles").upsert(
            {
              id: userId,
              email: email || null,
              ...(email === ADMIN_EMAIL ? { nome: "Administrador" } : {}),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
          await supabaseAdmin
            .from("user_roles")
            .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
          if (email === ADMIN_EMAIL) {
            await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "cliente");
            accessRoles = accessRoles.filter((role) => role !== "cliente");
          }
          accessRoles = Array.from(new Set<AppRole>(["admin", ...accessRoles]));
        }
      } catch (error) {
        console.error("Falha ao corrigir admin automaticamente", error);
      }
    }

    const ativo =
      sub?.status === "ativo" &&
      (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());

    return {
      roles: accessRoles,
      plano: ativo ? (sub!.plano as "start" | "pro" | "elite") : null,
      status: sub?.status ?? null,
    };
  });

async function assertStaff(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", userId);
  let roles = (data ?? []).map((r: any) => r.role);

  if (!roles.includes("admin") && !roles.includes("operador")) {
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      const email = String(userData.user?.email ?? "").trim().toLowerCase();

      if (email === ADMIN_EMAIL) {
        await supabaseAdmin.from("profiles").upsert(
          {
            id: userId,
            nome: "Administrador",
            email: ADMIN_EMAIL,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
        await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
        await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "cliente");
        roles = Array.from(new Set<AppRole>(["admin", ...roles.filter((role: AppRole) => role !== "cliente")]));
      }
    } catch {
      // Se não der para reparar, mantém bloqueio abaixo.
    }
  }

  if (!roles.includes("admin") && !roles.includes("operador")) {
    throw new Error("Acesso restrito");
  }
  return roles as AppRole[];
}

export const listClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await assertStaff(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: roles }, { data: subs }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, nome, email, cpf, data_nascimento, created_at"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("subscriptions").select("user_id, plano, status, periodo_fim"),
    ]);

    const roleMap = new Map<string, string[]>();
    for (const r of roles ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }
    const subMap = new Map<string, any>();
    for (const s of subs ?? []) subMap.set(s.user_id, s);

    return (profiles ?? []).map((p) => ({
      id: p.id,
      nome: p.nome,
      email: p.email,
      cpf: (p as any).cpf ?? null,
      data_nascimento: (p as any).data_nascimento ?? null,
      created_at: p.created_at,
      roles: roleMap.get(p.id) ?? [],
      plano: subMap.get(p.id)?.plano ?? null,
      status: subMap.get(p.id)?.status ?? "inativo",
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
    const { userId } = context;
    await assertStaff(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        nome: data.nome.trim() || null,
        email: data.email.trim() || null,
        cpf: data.cpf.replace(/\D/g, "") || null,
        data_nascimento: data.data_nascimento || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.clienteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setClientePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clienteId: string; senha: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const roles = await assertStaff(userId);
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
    (d: { clienteId: string; plano: "start" | "pro" | "elite"; status: "ativo" | "inativo" }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertStaff(userId);
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
      plano: "start" | "pro" | "elite";
      status: "ativo" | "inativo";
      isAdmin?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const roles = await assertStaff(userId);
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

    await supabaseAdmin.from("profiles").upsert(
      {
        id: newId,
        nome: data.nome.trim() || null,
        email: data.email.trim() || null,
        cpf: (data.cpf ?? "").replace(/\D/g, "") || null,
        data_nascimento: data.data_nascimento || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (data.isAdmin) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: newId, role: "admin" },
        { onConflict: "user_id,role" },
      );
    } else {
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
    const { userId } = context;
    await assertStaff(userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: roles }, { data: subs }, { data: planoCfg }] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("id, created_at"),
        supabaseAdmin.from("user_roles").select("user_id, role"),
        supabaseAdmin.from("subscriptions").select("user_id, plano, status, periodo_fim, created_at"),
        supabaseAdmin.from("plano_config").select("plano, preco"),
      ]);

    const parsePreco = (v: string | null | undefined) => {
      if (!v) return 0;
      const n = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".");
      return parseFloat(n) || 0;
    };
    const precoMap: Record<string, number> = { start: 29.9, pro: 49.9, elite: 79.9 };
    for (const p of planoCfg ?? []) precoMap[p.plano] = parsePreco(p.preco);

    // IDs que são apenas staff (admin/operador) não contam como clientes.
    const staffIds = new Set(
      (roles ?? [])
        .filter((r) => r.role === "admin" || r.role === "operador")
        .map((r) => r.user_id),
    );

    const subMap = new Map<string, any>();
    for (const s of subs ?? []) subMap.set(s.user_id, s);

    const clientes = (profiles ?? []).filter((p) => !staffIds.has(p.id));

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
      for (const s of subs ?? []) {
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
    const { userId } = context;
    const roles = await assertStaff(userId);
    if (!roles.includes("admin")) throw new Error("Acesso restrito");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("system_config")
      .select("chave, valor, descricao")
      .order("chave");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setSystemConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chave: string; valor: string; descricao?: string }) => d)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const roles = await assertStaff(userId);
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
