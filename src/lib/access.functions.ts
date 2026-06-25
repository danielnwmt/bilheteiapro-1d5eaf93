import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "operador" | "cliente";

export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: roles }, { data: sub }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("subscriptions")
        .select("plano, status, periodo_fim")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const ativo =
      sub?.status === "ativo" &&
      (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());

    return {
      roles: (roles ?? []).map((r) => r.role as AppRole),
      plano: ativo ? (sub!.plano as "start" | "pro" | "elite") : null,
      status: sub?.status ?? null,
    };
  });

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin") && !roles.includes("operador")) {
    throw new Error("Acesso restrito");
  }
  return roles as AppRole[];
}

export const listClientes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);

    const [{ data: profiles }, { data: roles }, { data: subs }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, cpf, data_nascimento, created_at"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("subscriptions").select("user_id, plano, status, periodo_fim"),
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
      created_at: p.created_at,
      roles: roleMap.get(p.id) ?? [],
      plano: subMap.get(p.id)?.plano ?? null,
      status: subMap.get(p.id)?.status ?? "inativo",
    }));
  });

export const setClientePlano = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { clienteId: string; plano: "start" | "pro" | "elite"; status: "ativo" | "inativo" }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);

    const { error } = await supabase.from("subscriptions").upsert(
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

export const getClientStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertStaff(supabase, userId);

    const [{ data: profiles }, { data: roles }, { data: subs }] = await Promise.all([
      supabase.from("profiles").select("id, created_at"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("subscriptions").select("user_id, plano, status, periodo_fim"),
    ]);

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

    return {
      totalClientes: clientes.length,
      ativos,
      inativos: clientes.length - ativos,
      porPlano,
      cadastrosPorMes: meses,
    };
  });

export const getSystemConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Acesso restrito");

    const { data } = await supabase
      .from("system_config")
      .select("chave, valor, descricao")
      .order("chave");
    return data ?? [];
  });

export const setSystemConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chave: string; valor: string; descricao?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Acesso restrito");

    const { error } = await supabase.from("system_config").upsert(
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
