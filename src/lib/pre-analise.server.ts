// Robô de pré-análise (chamado pelo cron a cada 5 min).
// Varre os jogos que ainda não começaram (e os ao vivo) com odds salvas, e
// roda o motor local uma vez por jogo/dia, salvando em analise_cache.
// Quando o cliente pede um bilhete, ele só LÊ desse cache.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { obterAnalisePartida, diaSaoPaulo, type PartidaRow } from "./analise.server";
import { hasApiFootballKey, syncEstatisticas, type EstatisticasResumo } from "./football.server";

// Casas exibidas no app. A análise é feita por casa porque os picks usam as
// odds reais daquela casa.
const APP_CASAS = ["Bet365", "Betano", "Superbet", "KTO", "Sportingbet", "Betfair"];

// Mantido por compatibilidade com o relatório do cron. A análise é local e gratuita.
const BUDGET_POR_RUN = 120;

function normKey(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface PreAnaliseResult {
  ok: boolean;
  jogos: number;
  analisados: number;
  jaEmCache: number;
  estatisticas: number;
  budget: number;
  avisos?: string[];
}


export async function preAnalisarTodos(): Promise<PreAnaliseResult> {
  const supabase = admin();
  // Análise 100% local: não precisa de modelo externo.
  const model = null;
  const avisos: string[] = [];
  const now = Date.now();
  const dia = diaSaoPaulo(new Date(now));

  // Janela: jogos ao vivo + os que começam nos próximos 8 dias.
  // Alinhada à janela de coleta de odds (8 dias): assim TODO jogo que já tem
  // odds salvas também é analisado, em vez de só os das próximas 48h — antes
  // jogos com odds a 2-3 dias apareciam sem análise.
  const liveFrom = new Date(now - 150 * 60_000).toISOString();
  const to = new Date(now + 8 * 24 * 3600_000).toISOString();

  const { data: partidas, error } = await supabase
    .from("partidas")
    // Evita o select aninhado `odds(...)`: no PostgREST ele vira LATERAL JOIN
    // e foi a query mais lenta do sistema. Lemos partidas e odds em 2 consultas
    // simples, ambas cobertas por índice.
    .select("id, external_id, liga, time_casa, time_fora, inicio, status")
    .neq("status", "encerrado")
    .or(`status.eq.ao_vivo,and(inicio.gte.${liveFrom},inicio.lte.${to})`)
    .order("inicio", { ascending: true })
    .limit(120);

  if (error) {
    console.error("pre-analise: erro ao ler partidas", error);
    throw new Error("Não foi possível ler os jogos para pré-análise.");
  }

  const baseRows = (partidas ?? []) as Array<Omit<PartidaRow, "odds">>;
  const partidaIdsParaOdds = baseRows.map((p) => p.id);
  const oddsByPartida = new Map<string, PartidaRow["odds"]>();
  if (partidaIdsParaOdds.length) {
    const { data: odds, error: oddsErr } = await supabase
      .from("odds")
      .select("partida_id, casa, mercado, selecao, valor, external_odd_id")
      .in("partida_id", partidaIdsParaOdds);
    if (oddsErr) {
      console.error("pre-analise: erro ao ler odds", oddsErr);
      throw new Error("Não foi possível ler as odds para pré-análise.");
    }
    for (const o of odds ?? []) {
      const partidaId = String((o as any).partida_id ?? "");
      if (!partidaId) continue;
      const list = oddsByPartida.get(partidaId) ?? [];
      list.push({
        casa: String((o as any).casa ?? ""),
        mercado: String((o as any).mercado ?? ""),
        selecao: String((o as any).selecao ?? ""),
        valor: Number((o as any).valor ?? 0),
        external_odd_id: (o as any).external_odd_id ?? null,
      });
      oddsByPartida.set(partidaId, list);
    }
  }

  const rows = baseRows.map((p) => ({ ...p, odds: oddsByPartida.get(p.id) ?? [] })) as PartidaRow[];

  // Como as odds são consenso (compartilhadas entre as casas), basta analisar
  // CADA JOGO UMA VEZ, usando a primeira casa do app que tenha odds. O cliente
  // reaproveita essa análise para qualquer casa selecionada.
  type Par = { partida: PartidaRow; casa: string };
  const candidatos: Par[] = [];
  for (const p of rows) {
    let casa: string | null = null;
    for (const c of APP_CASAS) {
      if (p.odds.some((o) => normKey(o.casa) === normKey(c))) {
        casa = c;
        break;
      }
    }
    if (casa) candidatos.push({ partida: p, casa });
  }

  // Quantos jogos já tinham análise hoje (só para relatório).
  const { data: jaCache } = await supabase
    .from("analise_cache")
    .select("partida_id")
    .eq("dia", dia);
  const cacheSet = new Set((jaCache ?? []).map((c: any) => String(c.partida_id)));

  // Prioriza candidatos AINDA SEM cache (para rolar por toda a janela de 8 dias
  // ao longo dos ciclos do cron) e, se sobrar espaço, reanalisa os já cacheados
  // para refletir odds novas durante o dia.
  const MAX_ANALISES_POR_RUN = 40;
  const semCache = candidatos.filter((c) => !cacheSet.has(c.partida.id));
  const comCache = candidatos.filter((c) => cacheSet.has(c.partida.id));
  const pendentes = [...semCache, ...comCache].slice(0, MAX_ANALISES_POR_RUN);

  // Coleta estatísticas reais (API-Football /predictions) dos jogos que serão
  // analisados e ainda não têm estatísticas salvas. 1 chamada por jogo.
  const partidaIds = candidatos.map((c) => c.partida.id);
  const statsMap = new Map<string, EstatisticasResumo>();
  if (partidaIds.length) {
    const { data: statsExist } = await supabase
      .from("estatisticas")
      .select("partida_id, payload")
      .eq("tipo", "predicoes")
      .in("partida_id", partidaIds);
    for (const s of statsExist ?? []) {
      statsMap.set(String((s as any).partida_id), (s as any).payload as EstatisticasResumo);
    }
  }

  let estatisticas = 0;
  // Cada estatística passa pelo throttle da API-Football. Mantemos baixo para
  // nenhum ciclo do cron monopolizar CPU/rede nem estourar timeout.
  const MAX_STATS_POR_RUN = 3;
  const semStats = candidatos
    .filter((c) => c.partida.external_id && !statsMap.has(c.partida.id))
    .slice(0, MAX_STATS_POR_RUN)
    .map((c) => ({
      id: c.partida.id,
      external_id: c.partida.external_id,
      time_casa: c.partida.time_casa,
      time_fora: c.partida.time_fora,
    }));
  const apiFootballConfigurada = await hasApiFootballKey();
  if (semStats.length && !apiFootballConfigurada) {
    avisos.push("API-Football não configurada; estatísticas reais pausadas.");
  }
  if (semStats.length && apiFootballConfigurada) {
    try {
      estatisticas = await syncEstatisticas(semStats);
      const { data: novos } = await supabase
        .from("estatisticas")
        .select("partida_id, payload")
        .eq("tipo", "predicoes")
        .in("partida_id", partidaIds);
      for (const s of novos ?? []) {
        statsMap.set(String((s as any).partida_id), (s as any).payload as EstatisticasResumo);
      }
    } catch (e) {
      const msg = String(e);
      // Chave da API-Football não configurada: não é erro do robô — apenas
      // segue sem estatísticas (evita poluir os logs dezenas de vezes/hora).
      if (msg.includes("Missing API_FOOTBALL_KEY")) {
        avisos.push("API-Football não configurada; estatísticas reais pausadas.");
      } else {
        console.error("pre-analise: falha ao coletar estatísticas", e);
      }
    }
  }

  // Anexa as estatísticas reais a cada jogo (usadas pelo motor estatístico local).
  for (const c of candidatos) {
    c.partida.estatisticas = statsMap.get(c.partida.id) ?? null;
  }

  // Análise LOCAL: é grátis e instantânea, então reanalisamos TODOS os jogos
  // numa só passada e sobrescrevemos o cache do dia (forcar = true).
  let analisados = 0;
  for (const c of pendentes) {
    try {
      const a = await obterAnalisePartida(supabase, model, c.partida, c.casa, dia, false, true);
      if (a.picks.length) analisados++;
    } catch (e) {
      console.error("pre-analise: falha ao analisar", c.partida.id, c.casa, e);
    }
  }

  return {
    ok: true,
    jogos: rows.length,
    analisados,
    jaEmCache: candidatos.filter((c) => cacheSet.has(c.partida.id)).length,
    estatisticas,
    budget: BUDGET_POR_RUN,
    avisos,
  };
}

