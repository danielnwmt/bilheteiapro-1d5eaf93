// Robô de pré-análise (chamado pelo cron a cada 5 min).
// Varre os jogos que ainda não começaram (e os ao vivo) com odds salvas, e
// chama a IA UMA vez por jogo/casa/dia, salvando em analise_cache.
// Quando o cliente pede um bilhete, ele só LÊ desse cache (sem chamar a IA).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAiModel } from "./ai-gateway.server";
import { obterAnalisePartida, diaSaoPaulo, type PartidaRow } from "./analise.server";

// Casas exibidas no app. A análise é feita por casa porque os picks usam as
// odds reais daquela casa.
const APP_CASAS = ["Bet365", "Betano", "Superbet", "KTO", "Sportingbet", "Betfair"];

// Limite de chamadas de IA por execução do cron (evita estourar o limite/429).
// Como o cache é diário, cada par jogo+casa só é analisado uma vez por dia;
// as execuções seguintes só completam o que faltou.
const BUDGET_POR_RUN = 12;

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

  // Monta os pares (jogo, casa) que têm odds e ainda não estão no cache do dia.
  type Par = { partida: PartidaRow; casa: string };
  const candidatos: Par[] = [];
  for (const p of rows) {
    const casasComOdd = new Set<string>();
    for (const o of p.odds) {
      const match = APP_CASAS.find((c) => normKey(c) === normKey(o.casa));
      if (match) casasComOdd.add(match);
    }
    for (const casa of casasComOdd) candidatos.push({ partida: p, casa });
  }

  // Quais já estão no cache de hoje?
  const { data: jaCache } = await supabase
    .from("analise_cache")
    .select("partida_id, casa")
    .eq("dia", dia);
  const cacheSet = new Set((jaCache ?? []).map((c: any) => `${c.partida_id}::${normKey(c.casa)}`));

  const pendentes = candidatos.filter((c) => !cacheSet.has(`${c.partida.id}::${normKey(c.casa)}`));

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
    budget: BUDGET_POR_RUN,
  };
}
