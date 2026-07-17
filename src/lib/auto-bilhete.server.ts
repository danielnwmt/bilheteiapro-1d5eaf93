// Robô autônomo: monta bilhetes usando somente odds reais salvas,
// estatísticas do banco e o motor estatístico local. Não usa IA/LLM.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { analisarLocal } from "./analise-local.server";
import type { PartidaRow, PickAnalise } from "./analise.server";
import type { EstatisticasResumo } from "./football.server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Configuração de cada tipo de bilhete que o robô monta.
export interface BilheteConfig {
  tipo: string;
  janelaHoras: number;
  oddMinJogo: number;
  oddMaxJogo: number; // Infinity = sem limite superior por jogo
  oddMinTotal: number; // 1 = sem mínimo
  oddMaxTotal: number;
  minJogos: number;
  maxJogos: number;
  mercados: string[] | null; // palavras-chave de mercados; null = qualquer
}

const CASA = "Bet365";
// Ligas principais: Brasileirão Série A e Série B (nomes gravados na coluna "liga").
const LIGAS_FOCO = ["Brasileirão Série A", "Brasileirão Série B"];

const CONFIG_PADRAO: BilheteConfig = {
  tipo: "padrao",
  janelaHoras: 4,
  oddMinJogo: 1.4,
  oddMaxJogo: Infinity,
  oddMinTotal: 1,
  oddMaxTotal: 3.5,
  minJogos: 1,
  maxJogos: 3,
  mercados: null,
};

const CONFIG_SUPER: BilheteConfig = {
  tipo: "super_multipla",
  janelaHoras: 4,
  oddMinJogo: 1.6,
  oddMaxJogo: 2.2,
  oddMinTotal: 15,
  oddMaxTotal: 30,
  minJogos: 4,
  maxJogos: 5,
  mercados: [
    "vitoria", "vencedor", "resultado", "match winner", "1x2",
    "ambos marcam", "both teams", "cartoes", "cartao", "card",
    "escanteio", "corner", "gol", "goal", "over", "under", "total",
  ],
};

function normKey(v: string) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mercadoPermitido(cfg: BilheteConfig, mercado: string, selecao: string) {
  if (!cfg.mercados) return true;
  const alvo = `${normKey(mercado)} ${normKey(selecao)}`;
  return cfg.mercados.some((m) => alvo.includes(normKey(m)));
}

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface AutoResult {
  ok: boolean;
  tipo: string;
  bilheteId?: string;
  jogosAnalisados: number;
  picks: number;
  oddTotal?: number;
  motivo?: string;
}

type OddRow = PartidaRow["odds"][number];
type PartidaComStats = PartidaRow & { estatisticas?: EstatisticasResumo | null };
type Pick = {
  partida_id: string;
  jogo: string;
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
  justificativa: string;
  external_odd_id: string | null;
  estrelas: number;
  evPct: number;
};

function oddElegivel(cfg: BilheteConfig, o: OddRow) {
  return (
    normKey(o.casa) === normKey(CASA) &&
    Number.isFinite(o.valor) &&
    o.valor >= cfg.oddMinJogo &&
    o.valor <= cfg.oddMaxJogo &&
    mercadoPermitido(cfg, o.mercado, o.selecao)
  );
}

function pickElegivel(cfg: BilheteConfig, p: PickAnalise) {
  return (
    Number.isFinite(p.odd) &&
    p.odd >= cfg.oddMinJogo &&
    p.odd <= cfg.oddMaxJogo &&
    mercadoPermitido(cfg, p.mercado, p.selecao)
  );
}

function scorePick(p: Pick) {
  return p.confianca * 10 + p.estrelas * 25 + Math.max(0, p.evPct) * 2 - Math.max(0, p.odd - 2.5) * 8;
}

function oddTotalDe(arr: Pick[]) {
  return arr.reduce((t, p) => t * p.odd, 1);
}

function escolherCombinacao(candidatos: Pick[], cfg: BilheteConfig): Pick[] {
  const ordenados = [...candidatos].sort((a, b) => scorePick(b) - scorePick(a)).slice(0, 18);
  let melhor: Pick[] = [];
  let melhorScore = -Infinity;

  const dfs = (inicio: number, atual: Pick[]) => {
    if (atual.length >= cfg.minJogos) {
      const oddTotal = oddTotalDe(atual);
      if (oddTotal >= cfg.oddMinTotal && oddTotal <= cfg.oddMaxTotal) {
        const alvo = cfg.oddMinTotal > 1 ? (cfg.oddMinTotal + cfg.oddMaxTotal) / 2 : Math.min(2.2, cfg.oddMaxTotal);
        const proximidade = -Math.abs(Math.log(oddTotal / alvo)) * 35;
        const mediaScore = atual.reduce((s, p) => s + scorePick(p), 0) / atual.length;
        const score = mediaScore + proximidade + atual.length * 3;
        if (score > melhorScore) {
          melhorScore = score;
          melhor = [...atual];
        }
      }
    }
    if (atual.length >= cfg.maxJogos) return;

    for (let i = inicio; i < ordenados.length; i++) {
      const prox = ordenados[i];
      const novaOdd = oddTotalDe(atual) * prox.odd;
      // Para bilhete padrão, evita continuar quando já passou muito do teto.
      if (cfg.oddMinTotal <= 1 && novaOdd > cfg.oddMaxTotal * 1.15) continue;
      atual.push(prox);
      dfs(i + 1, atual);
      atual.pop();
    }
  };

  dfs(0, []);
  return melhor;
}

async function montarBilhete(cfg: BilheteConfig): Promise<AutoResult> {
  const supabase = admin();
  const now = Date.now();
  const from = new Date(now).toISOString();
  const to = new Date(now + cfg.janelaHoras * 3600_000).toISOString();

  const { data: partidas, error } = await supabase
    .from("partidas")
    .select("id, external_id, liga, time_casa, time_fora, inicio, status, arbitro, odds(casa, mercado, selecao, valor, external_odd_id)")
    .in("liga", LIGAS_FOCO)
    .or(`status.eq.ao_vivo,and(inicio.gte.${from},inicio.lte.${to})`)
    .order("inicio", { ascending: true })
    .limit(20);

  if (error) {
    console.error("auto-bilhete: erro ao ler partidas", error);
    return { ok: false, tipo: cfg.tipo, jogosAnalisados: 0, picks: 0, motivo: "Erro ao ler partidas." };
  }

  const rows = ((partidas ?? []) as PartidaComStats[]).filter((r) => r.odds?.some((o) => oddElegivel(cfg, o)));
  if (!rows.length) {
    return { ok: true, tipo: cfg.tipo, jogosAnalisados: 0, picks: 0, motivo: "Nenhum jogo elegível com odds salvas." };
  }

  try {
    const ids = rows.map((r) => r.id);
    const { data: stats } = await supabase
      .from("estatisticas")
      .select("partida_id, payload")
      .eq("tipo", "predicoes")
      .in("partida_id", ids);
    const statsMap = new Map<string, EstatisticasResumo>();
    for (const s of stats ?? []) statsMap.set(String((s as any).partida_id), (s as any).payload as EstatisticasResumo);
    for (const r of rows) r.estatisticas = statsMap.get(r.id) ?? null;
  } catch (e) {
    console.error("auto-bilhete: falha ao buscar estatísticas", e);
  }

  const candidatos: Pick[] = [];
  for (const partida of rows) {
    const analise = analisarLocal(partida, CASA);
    const melhor = analise.picks
      .filter((p) => pickElegivel(cfg, p))
      // Bloco 1: bilhetes automáticos e Super Múltipla NUNCA aceitam
      // picks "market_only" (sem estatísticas) nem "unavailable".
      .filter((p) => {
        const q = (p as any).analysisQuality as string | undefined;
        return q !== "market_only" && q !== "unavailable";
      })
      .sort((a, b) =>
        (b.estrelas ?? 0) - (a.estrelas ?? 0) ||
        b.confianca - a.confianca ||
        (b.evPct ?? 0) - (a.evPct ?? 0),
      )[0];

    if (!melhor) continue;
    candidatos.push({
      partida_id: partida.id,
      jogo: `${partida.time_casa} x ${partida.time_fora}`,
      mercado: melhor.mercado,
      selecao: melhor.selecao,
      odd: melhor.odd,
      confianca: Math.max(1, Math.min(96, Math.round(melhor.confianca || 60))),
      justificativa: melhor.justificativa || melhor.motivos?.join(" • ") || "Pick selecionada pelo motor estatístico local.",
      external_odd_id: melhor.external_odd_id,
      estrelas: melhor.estrelas ?? 2,
      evPct: melhor.evPct ?? 0,
    });
  }


  if (candidatos.length < cfg.minJogos) {
    return {
      ok: true,
      tipo: cfg.tipo,
      jogosAnalisados: rows.length,
      picks: 0,
      motivo: `Picks elegíveis insuficientes (${candidatos.length}) para ${cfg.tipo} (mín. ${cfg.minJogos}).`,
    };
  }

  const escolhidos = escolherCombinacao(candidatos, cfg);
  if (!escolhidos.length) {
    return {
      ok: true,
      tipo: cfg.tipo,
      jogosAnalisados: rows.length,
      picks: 0,
      motivo: `Não foi possível montar ${cfg.tipo} dentro das regras de odd total.`,
    };
  }

  const oddTotal = Number(oddTotalDe(escolhidos).toFixed(2));
  const avg = escolhidos.reduce((s, p) => s + p.confianca, 0) / escolhidos.length;
  const risco = cfg.tipo === "super_multipla"
    ? avg >= 82 ? "medio" : "alto"
    : oddTotal <= 2.2 && avg >= 70 ? "baixo" : avg < 55 ? "alto" : "medio";

  const resumo = cfg.tipo === "super_multipla"
    ? `Super Múltipla local (${escolhidos.length} jogos, odd total ${oddTotal}).`
    : `Bilhete automático local (${escolhidos.length} jogo(s), odd total ${oddTotal}).`;

  const { data: bilhete, error: errBilhete } = await supabase
    .from("bilhetes")
    .insert({
      resumo,
      odd_total: oddTotal,
      risco,
      observacoes: "Gerado pelo motor estatístico local com odds reais salvas; confirme as odds na casa antes de apostar.",
      casa: CASA,
      periodo: "aovivo",
      tipo: cfg.tipo,
    })
    .select("id")
    .single();

  if (errBilhete || !bilhete) {
    console.error("auto-bilhete: erro ao salvar bilhete", errBilhete);
    return { ok: false, tipo: cfg.tipo, jogosAnalisados: rows.length, picks: 0, motivo: "Erro ao salvar bilhete." };
  }

  const { error: errPalpites } = await supabase.from("palpites").insert(
    escolhidos.map((p) => ({
      bilhete_id: bilhete.id,
      partida_id: p.partida_id,
      mercado: p.mercado,
      selecao: p.selecao,
      odd: p.odd,
      confianca: p.confianca,
      justificativa: p.justificativa,
    })),
  );
  if (errPalpites) console.error("auto-bilhete: erro ao salvar palpites", errPalpites);

  return {
    ok: true,
    tipo: cfg.tipo,
    bilheteId: bilhete.id,
    jogosAnalisados: rows.length,
    picks: escolhidos.length,
    oddTotal,
  };
}

export async function gerarBilheteAutomatico(): Promise<AutoResult> {
  return montarBilhete(CONFIG_PADRAO);
}

export async function gerarSuperMultipla(): Promise<AutoResult> {
  return montarBilhete(CONFIG_SUPER);
}

export async function gerarTodosBilhetes(): Promise<AutoResult[]> {
  const padrao = await gerarBilheteAutomatico();
  await sleep(500);
  const superMultipla = await gerarSuperMultipla();
  return [padrao, superMultipla];
}
