import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { diaSaoPaulo } from "./analise.server";
import { getPlanoAccess } from "./plan-gates.server";

function normKey(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LIGA_ALIASES: Record<string, string[]> = {
  "brasileirao serie a": ["brasileirao serie a", "serie a brazil", "brazil serie a", "brasileirao"],
  "brasileirao serie b": ["brasileirao serie b", "serie b brazil", "brazil serie b"],
  "brasileirao serie c": ["brasileirao serie c", "serie c brazil", "brazil serie c"],
  "brasileirao serie d": ["brasileirao serie d", "serie d brazil", "brazil serie d"],
  "copa do brasil": ["copa do brasil", "brazil cup"],
  libertadores: ["libertadores", "copa libertadores", "conmebol libertadores"],
  "sul americana": ["sul americana", "copa sudamericana", "conmebol sudamericana", "sudamericana"],
  "premier league": ["premier league", "english premier league", "epl"],
  "la liga": ["la liga", "laliga", "primera division"],
  "serie a italia": ["serie a italia", "serie a", "italy serie a"],
  bundesliga: ["bundesliga", "1 bundesliga", "germany bundesliga"],
  "ligue 1": ["ligue 1", "france ligue 1"],
  "champions league": ["champions league", "uefa champions league", "liga dos campeoes"],
  "europa league": ["europa league", "uefa europa league", "liga europa"],
  "conference league": ["conference league", "uefa europa conference league", "europa conference league"],
  "copa do mundo": ["copa do mundo", "world cup", "fifa world cup", "copa do mundo fifa"],
};

function ligaLiberadaPorPlano(liga: string | null, ligas: string[] | null) {
  if (ligas === null) return true; // staff: tudo liberado
  if (!liga) return false;
  const ligaKey = normKey(liga);
  return ligas.some((c) => {
    const ck = normKey(c);
    if (ligaKey === ck) return true;
    const aliases = LIGA_ALIASES[ck];
    return aliases ? aliases.some((a) => ligaKey === a) : false;
  });
}

export type MelhorEntrada = {
  jogo: string;
  liga: string | null;
  inicio: string;
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
  qualidade?: "estatistica" | "mercado";
};

function normalizarConfianca(odd: number, confianca: number, marketOnly = false) {
  if (marketOnly) {
    const implicita = odd ? Math.round((1 / odd) * 100) : Math.round(confianca || 0);
    return Math.max(35, Math.min(55, Math.round(35 + implicita * 0.20)));
  }
  return Math.round(confianca || 0);
}

function traduzSelecao(selecao: string) {
  return String(selecao ?? "")
    .replace(/\bOver\s*([0-9.]+)?/gi, (_m, n) => `Mais de${n ? ` ${n}` : ""}`)
    .replace(/\bUnder\s*([0-9.]+)?/gi, (_m, n) => `Menos de${n ? ` ${n}` : ""}`)
    .replace(/\bDraw\b/gi, "Empate")
    .replace(/\bYes\b/gi, "Sim")
    .replace(/\bNo\b/gi, "Não");
}

// Lê as melhores entradas já analisadas pelo robô (analise_cache) para os jogos
// que ainda não começaram. Retorna as seleções de maior confiança.
export const getMelhoresEntradas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dia = diaSaoPaulo();
    const agora = new Date().toISOString();

    // Controle de acesso por plano: cliente só vê ligas liberadas no plano.
    const access = await getPlanoAccess(supabaseAdmin, context.userId, context.claims);
    const ligasLiberadas: string[] | null = access.isStaff ? null : (access.cfg?.ligas ?? []);
    // Cliente sem plano ativo não vê nenhuma entrada.
    if (!access.isStaff && !access.plano) return { entradas: [] as MelhorEntrada[] };

    // Jogos que ainda não começaram.
    const { data: partidas } = await supabaseAdmin
      .from("partidas")
      .select("id, liga, time_casa, time_fora, inicio, status")
      .neq("status", "encerrado")
      .gte("inicio", agora)
      .order("inicio", { ascending: true })
      .limit(120);

    const rows = ((partidas ?? []) as Array<{
      id: string;
      liga: string | null;
      time_casa: string;
      time_fora: string;
      inicio: string;
      status: string;
    }>).filter((r) => ligaLiberadaPorPlano(r.liga, ligasLiberadas));
    if (!rows.length) return { entradas: [] as MelhorEntrada[] };


    const ids = rows.map((r) => r.id);
    const { data: caches } = await supabaseAdmin
      .from("analise_cache")
      .select("partida_id, payload")
      .eq("dia", dia)
      .in("partida_id", ids);

    const porPartida = new Map<string, any>();
    for (const c of caches ?? []) {
      if (!porPartida.has((c as any).partida_id)) {
        porPartida.set((c as any).partida_id, (c as any).payload);
      }
    }

    const entradas: MelhorEntrada[] = [];
    for (const r of rows) {
      const payload = porPartida.get(r.id);
      const picks = Array.isArray(payload?.picks) ? payload.picks : [];
      if (!picks.length) continue;
      // Preferência: entradas com estatísticas. Se ainda não houver estatísticas
      // porque a API está indisponível/sem chave válida, mostra leitura de mercado
      // para a tela não ficar vazia.
      const analisadas = picks.filter((p: any) => {
        const q = p?.analysisQuality;
        return q !== "market_only" && q !== "unavailable";
      });
      const usarFallbackMercado = analisadas.length === 0;
      const base = usarFallbackMercado
        ? picks.filter((p: any) => p?.analysisQuality !== "unavailable")
        : analisadas;
      if (!base.length) continue;
      const best = [...base].sort((a: any, b: any) => (b.confianca ?? 0) - (a.confianca ?? 0))[0];
      if (!best) continue;
      const odd = Number(best.odd) || 0;
      entradas.push({
        jogo: `${r.time_casa} x ${r.time_fora}`,
        liga: r.liga,
        inicio: r.inicio,
        mercado: best.mercado,
        selecao: traduzSelecao(best.selecao),
        odd,
        confianca: normalizarConfianca(odd, Number(best.confianca) || 0, usarFallbackMercado),
        qualidade: usarFallbackMercado ? "mercado" : "estatistica",
      });
    }

    entradas.sort((a, b) => b.confianca - a.confianca);
    return { entradas: entradas.slice(0, 12) };
  });
