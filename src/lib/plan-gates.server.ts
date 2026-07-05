import type { Recurso } from "./planos";

export type PlanoAccess = {
  isStaff: boolean;
  plano: string | null;
  status: string | null;
  periodoFim: string | null;
  cfg: {
    historico_dias: number;
    ligas: string[];
    recursos: Partial<Record<Recurso, boolean>>;
  } | null;
};

export const ADMIN_EMAIL = "contato@protenexus.com";

function emailFromClaims(claims: unknown): string {
  const c = (claims ?? {}) as Record<string, unknown>;
  return String(c.email ?? c.user_email ?? "")
    .trim()
    .toLowerCase();
}

function planoAtivo(
  sub: { status?: string | null; periodo_fim?: string | null } | null | undefined,
) {
  return (
    (sub?.status === "ativo" || sub?.status === "cortesia") &&
    (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date())
  );
}

export async function getPlanoAccess(
  supabase: any,
  userId: string,
  claims?: unknown,
): Promise<PlanoAccess> {
  const email = emailFromClaims(claims);

  const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);

  const roles = (roleRows ?? []).map((r: any) => String(r.role));
  const isStaff = roles.includes("admin") || roles.includes("operador") || email === ADMIN_EMAIL;

  if (isStaff) {
    return {
      isStaff: true,
      plano: "elite",
      status: "ativo",
      periodoFim: null,
      cfg: null,
    };
  }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plano, status, periodo_fim")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!planoAtivo(sub) || !sub?.plano) {
    return {
      isStaff: false,
      plano: null,
      status: sub?.status ?? null,
      periodoFim: sub?.periodo_fim ?? null,
      cfg: null,
    };
  }

  const { data: cfg } = await supabase
    .from("plano_config")
    .select("historico_dias, ligas, recursos")
    .eq("plano", sub.plano)
    .maybeSingle();

  return {
    isStaff: false,
    plano: sub.plano,
    status: sub.status ?? null,
    periodoFim: sub.periodo_fim ?? null,
    cfg: {
      historico_dias: Number(cfg?.historico_dias ?? 15),
      ligas: Array.isArray(cfg?.ligas) ? cfg.ligas : [],
      recursos: (cfg?.recursos ?? {}) as Partial<Record<Recurso, boolean>>,
    },
  };
}

export async function assertPlanoAtivo(
  supabase: any,
  userId: string,
  claims?: unknown,
): Promise<PlanoAccess> {
  const access = await getPlanoAccess(supabase, userId, claims);
  if (!access.isStaff && !access.plano) {
    throw new Error("Assine um plano ativo para acessar este recurso.");
  }
  return access;
}

export async function assertRecursoPlano(
  supabase: any,
  userId: string,
  recurso: Recurso,
  claims?: unknown,
  mensagem?: string,
): Promise<PlanoAccess> {
  const access = await assertPlanoAtivo(supabase, userId, claims);
  if (access.isStaff) return access;
  if (!access.cfg?.recursos?.[recurso]) {
    throw new Error(mensagem ?? "Este recurso não está disponível no seu plano atual.");
  }
  return access;
}

export function dataMinimaHistorico(access: PlanoAccess): string | null {
  if (access.isStaff) return null;
  const dias = Math.max(1, Number(access.cfg?.historico_dias ?? 15));
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}
