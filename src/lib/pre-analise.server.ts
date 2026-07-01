// Robô de pré-análise (chamado pelo cron a cada 5 min).
// Varre os jogos que ainda não começaram (e os ao vivo) com odds salvas, e
// chama a IA UMA vez por jogo/casa/dia, salvando em analise_cache.
// Quando o cliente pede um bilhete, ele só LÊ desse cache (sem chamar a IA).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAiModel } from "./ai-gateway.server";
import { obterAnalisePartida, diaSaoPaulo, type PartidaRow } from "./analise.server";
import { syncEstatisticas, type EstatisticasResumo } from "./football.server";

// Casas exibidas no app. A análise é feita por casa porque os picks usam as
// odds reais daquela casa.
const APP_CASAS = ["Bet365", "Betano", "Superbet", "KTO", "Sportingbet", "Betfair"];

// Limite de chamadas de IA por execução do cron (evita estourar o limite/429).
// Como o cache é diário, cada par jogo+casa só é analisado uma vez por dia;
// as execuções seguintes só completam o que faltou.
const BUDGET_POR_RUN = 18;

function normKey(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
}


export async function preAnalisarTodos(): Promise<PreAnaliseResult> {
  const supabase = admin();
  const model = await getAiModel();
  const now = Date.now();
  const dia = diaSaoPaulo(new Date(now));

  // Janela: jogos ao vivo + os que começam nas próximas 48h.
  const liveFrom = new Date(now - 150 * 60_000).toISOString();
  const to = new Date(now + 48 * 3600_000).toISOString();

  const { data: partidas, error } = await supabase
    .from("partidas")
    .select("id, external_id, liga, time_casa, time_fora, inicio, status, odds(casa, mercado, selecao, valor, external_odd_id)")
    .neq("status", "encerrado")
    .or(`status.eq.ao_vivo,and(inicio.gte.${liveFrom},inicio.lte.${to})`)
    .order("inicio", { ascending: true })
    .limit(120);

  if (error) {
    console.error("pre-analise: erro ao ler partidas", error);
    throw new Error("Não foi possível ler os jogos para pré-análise.");
  }

  const rows = (partidas ?? []) as PartidaRow[];

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

  // Quais jogos já têm análise hoje (em qualquer casa)?
  const { data: jaCache } = await supabase
    .from("analise_cache")
    .select("partida_id")
    .eq("dia", dia);
  const cacheSet = new Set((jaCache ?? []).map((c: any) => String(c.partida_id)));

  const pendentes = candidatos.filter((c) => !cacheSet.has(c.partida.id));

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
  const semStats = candidatos
    .filter((c) => c.partida.external_id && !statsMap.has(c.partida.id))
    .map((c) => ({ id: c.partida.id, external_id: c.partida.external_id }));
  if (semStats.length) {
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
        console.warn("pre-analise: API_FOOTBALL_KEY não configurada — seguindo sem estatísticas");
      } else {
        console.error("pre-analise: falha ao coletar estatísticas", e);
      }
    }
  }

  // Anexa as estatísticas reais a cada jogo (usadas no prompt da IA).
  for (const c of candidatos) {
    c.partida.estatisticas = statsMap.get(c.partida.id) ?? null;
  }

  let analisados = 0;
  for (const c of pendentes) {
    if (analisados >= BUDGET_POR_RUN) break;
    try {
      if (analisados > 0) await sleep(1500);
      const a = await obterAnalisePartida(supabase, model, c.partida, c.casa, dia, false);
      if (a.picks.length) analisados++;
    } catch (e) {
      console.error("pre-analise: falha ao analisar", c.partida.id, c.casa, e);
    }
  }

  return {
    ok: true,
    jogos: rows.length,
    analisados,
    jaEmCache: candidatos.length - pendentes.length,
    estatisticas,
    budget: BUDGET_POR_RUN,
  };
}

