// Melhores Picks do Dia — ranqueia as melhores seleções individuais dos jogos
// de hoje usando SOMENTE o cache de análise já produzido pelo robô (nenhuma
// chamada de IA aqui). Respeita o mesmo controle de acesso por plano do
// gerarBilhete: staff vê tudo; cliente vê apenas as ligas liberadas.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type Plano } from "./planos";
import { analisarPartidas, diaSaoPaulo, type PartidaRow as AnalisePartidaRow } from "./analise.server";

const InputSchema = z.object({
  limite: z.number().min(1).max(30).optional().default(12),
  minConfianca: z.number().min(0).max(100).optional().default(70),
});

export type MelhorPick = {
  partidaId: string;
  jogo: string;
  liga: string | null;
  data: string;
  inicio: string;
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
  justificativa: string;
  estrelas: number;
  evPct: number | null;
  valorLabel: string | null;
};

function normKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const LIGA_ALIASES: Record<string, string[]> = {
  "brasileirao serie a": ["brasileirao serie a", "serie a brazil", "brazil serie a", "brasileirao"],
  "brasileirao serie b": ["brasileirao serie b", "serie b brazil", "brazil serie b"],
  "copa do brasil": ["copa do brasil", "brazil cup"],
  "libertadores": ["libertadores", "copa libertadores", "conmebol libertadores"],
  "sul americana": ["sul americana", "copa sudamericana", "conmebol sudamericana", "sudamericana"],
  "premier league": ["premier league", "english premier league", "epl"],
  "la liga": ["la liga", "laliga", "primera division"],
  "serie a italia": ["serie a italia", "serie a", "italy serie a"],
  "bundesliga": ["bundesliga", "1 bundesliga", "germany bundesliga"],
  "ligue 1": ["ligue 1", "france ligue 1"],
  "champions league": ["champions league", "uefa champions league", "liga dos campeoes"],
  "europa league": ["europa league", "uefa europa league", "liga europa"],
  "conference league": ["conference league", "uefa europa conference league", "europa conference league"],
  "copa do mundo": ["copa do mundo", "world cup", "fifa world cup", "copa do mundo fifa"],
};

function ligaLiberadaPorPlano(liga: string | null, ligas: string[] | null) {
  if (ligas === null) return true; // staff
  if (!liga) return false;
  const ligaKey = normKey(liga);
  return ligas.some((c) => {
    const ck = normKey(c);
    if (ligaKey === ck) return true;
    const aliases = LIGA_ALIASES[ck];
    return aliases ? aliases.some((a) => ligaKey === a) : false;
  });
}

function formatMatchDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function fimDoDiaSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = asUtc - new Date(now).setSeconds(0, 0);
  const startOfDaySP = Date.UTC(get("year"), get("month") - 1, get("day")) - offset;
  return startOfDaySP + 86400000; // fim do dia SP em ms UTC
}

type OddRow = { casa: string; mercado: string; selecao: string; valor: number; external_odd_id: string | null };
type PartidaRow = {
  id: string;
  external_id: string | null;
  liga: string | null;
  time_casa: string;
  time_fora: string;
  inicio: string;
  status: string;
  odds: OddRow[];
};

export const getMelhoresPicks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // ---- Controle de acesso por plano (idêntico ao gerarBilhete) ----
    const [{ data: roleRows }, { data: userData }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      supabaseAdmin.auth.admin.getUserById(context.userId),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role);
    const userEmail = String(userData.user?.email ?? (context.claims as any)?.email ?? "").trim().toLowerCase();
    const isStaff = roles.includes("admin") || roles.includes("operador") || userEmail === "contato@protenexus.com";

    let ligasLiberadas: string[] | null = null; // null = tudo (staff)
    if (!isStaff) {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("plano, status, periodo_fim")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ativo =
        (sub?.status === "ativo" || sub?.status === "cortesia" || sub?.status === "cancelado") &&
        (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());
      const plano: Plano | null = ativo ? (sub!.plano as Plano) : null;
      if (!plano) {
        throw new Error("Assine um plano para ver os melhores picks do dia.");
      }
      const { data: cfg } = await supabaseAdmin
        .from("plano_config")
        .select("ligas, recursos")
        .eq("plano", plano)
        .maybeSingle();
      const recursos = (cfg?.recursos ?? {}) as Record<string, boolean>;
      if (!recursos.melhoresPicks) {
        throw new Error("Os Melhores Picks estão disponíveis a partir do plano Pro.");
      }
      ligasLiberadas = Array.isArray(cfg?.ligas) ? (cfg!.ligas as string[]) : [];
    }


    const now = new Date();
    const from = now.getTime();
    const to = fimDoDiaSaoPaulo(now);
    const nowIso = now.toISOString();

    const { data: partidas, error } = await supabaseAdmin
      .from("partidas")
      .select("id, external_id, liga, time_casa, time_fora, inicio, status, odds(casa, mercado, selecao, valor, external_odd_id)")
      .gte("inicio", new Date(from).toISOString())
      .lte("inicio", new Date(to).toISOString())
      .neq("status", "encerrado")
      .order("inicio", { ascending: true })
      .limit(120);

    if (error) {
      console.error("Erro ao ler partidas (melhores picks)", error);
      throw new Error("Não foi possível ler os jogos do banco. Tente novamente.");
    }

    let rows = (partidas ?? []) as PartidaRow[];
    rows = rows.filter(
      (r) =>
        r.status !== "encerrado" &&
        r.inicio >= nowIso &&
        r.odds.length > 0 &&
        ligaLiberadaPorPlano(r.liga, ligasLiberadas),
    );

    if (!rows.length) {
      return { picks: [] as MelhorPick[], geradoEm: new Date().toISOString() };
    }

    // Escolhe a casa com maior cobertura só para ler as odds/análises.
    const cobertura = new Map<string, number>();
    for (const r of rows) {
      for (const c of new Set(r.odds.map((o) => o.casa))) cobertura.set(c, (cobertura.get(c) ?? 0) + 1);
    }
    const casa = [...cobertura.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Bet365";

    const dia = diaSaoPaulo(now);
    const aAnalisar = rows.slice(0, 50);
    const { resultado: analises } = await analisarPartidas(
      supabaseAdmin,
      null as never,
      aAnalisar as unknown as AnalisePartidaRow[],
      casa,
      dia,
      8,
      true, // somenteCache: nunca chama IA
    );

    if (!analises.size) {
      return { picks: [] as MelhorPick[], geradoEm: new Date().toISOString() };
    }

    const candidatosStrict: MelhorPick[] = [];
    const candidatosFallback: MelhorPick[] = [];
    for (const r of aAnalisar) {
      const a = analises.get(r.id);
      if (!a) continue;
      const jogo = `${r.time_casa} x ${r.time_fora}`;
      for (const p of a.picks) {
        if (p.confianca < data.minConfianca) continue;
        const q = (p as any).analysisQuality as string | undefined;
        const item: MelhorPick = {
          partidaId: r.id,
          jogo,
          liga: r.liga,
          data: formatMatchDate(r.inicio),
          inicio: r.inicio,
          mercado: p.mercado,
          selecao: p.selecao,
          odd: p.odd,
          confianca: p.confianca,
          justificativa: p.justificativa,
          estrelas: p.estrelas ?? 0,
          evPct: typeof p.evPct === "number" ? p.evPct : null,
          valorLabel: p.valorLabel ?? null,
        };
        // Estrito: análise com estatísticas (complete/partial) e EV positivo.
        if (q !== "market_only" && q !== "unavailable" && (typeof p.evPct !== "number" || p.evPct > 0)) {
          candidatosStrict.push(item);
        } else {
          // Fallback: quando não há estatísticas (chave inválida/robô ainda
          // não puxou), evita tela vazia mostrando picks só por odds.
          candidatosFallback.push(item);
        }
      }
    }

    const score = (p: MelhorPick) =>
      (p.evPct ?? 0) * 1.5 + p.estrelas * 8 + p.confianca;
    candidatosStrict.sort((x, y) => score(y) - score(x) || y.odd - x.odd);
    candidatosFallback.sort((x, y) => score(y) - score(x) || y.odd - x.odd);
    const candidatos = [...candidatosStrict, ...candidatosFallback];

    // No máximo 1 pick por jogo, para dar variedade à lista.
    const vistos = new Set<string>();
    const picks: MelhorPick[] = [];
    for (const c of candidatos) {
      if (vistos.has(c.partidaId)) continue;
      vistos.add(c.partidaId);
      picks.push(c);
      if (picks.length >= data.limite) break;
    }

    return { picks, geradoEm: new Date().toISOString() };
  });
