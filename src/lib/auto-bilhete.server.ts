// Robô autônomo: varre a API-Football por jogos nas próximas 4h (ligas principais),
// busca odds reais, chama o Gemini e salva o bilhete + palpites no banco.
// Server-only (service role + chave da IA).
import { generateText } from "ai";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAiModel } from "./ai-gateway.server";
import { syncFixtures, syncOdds } from "./football.server";

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

const CASA = "Betano";
// Ligas principais: Brasileirão Série A e Série B (nomes gravados na coluna "liga").
const LIGAS_FOCO = ["Brasileirão Série A", "Brasileirão Série B"];

// Bilhete padrão (conservador).
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

// Super Múltipla: 4-5 jogos de alta confiança, odds individuais 1.60-2.20,
// odd total combinada entre 15.00 e 30.00, mercados de vitória/ambos marcam/cartões/escanteios/gols.
const CONFIG_SUPER: BilheteConfig = {
  tipo: "super_multipla",
  janelaHoras: 4,
  oddMinJogo: 1.6,
  oddMaxJogo: 2.2,
  oddMinTotal: 15,
  oddMaxTotal: 30,
  minJogos: 4,
  maxJogos: 5,
  mercados: ["vitoria", "vencedor", "resultado", "match winner", "1x2", "ambos marcam", "both teams", "cartoes", "cartao", "card", "escanteio", "corner", "gol", "goal", "over", "under", "total"],
};

function mercadoPermitido(cfg: BilheteConfig, mercado: string, selecao: string) {
  if (!cfg.mercados) return true;
  const alvo = `${normKey(mercado)} ${normKey(selecao)}`;
  return cfg.mercados.some((m) => alvo.includes(normKey(m)));
}

type OddRow = {
  casa: string;
  mercado: string;
  selecao: string;
  valor: number;
  external_odd_id: string | null;
};
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

function normKey(v: string) {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function extractJson(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON não encontrado");
  return cleaned.slice(start, end + 1);
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

async function montarBilhete(cfg: BilheteConfig): Promise<AutoResult> {
  const supabase = admin();
  const now = Date.now();
  const from = new Date(now).toISOString();
  const to = new Date(now + cfg.janelaHoras * 3600_000).toISOString();

  // 1) Garante fixtures de hoje no banco.
  try {
    await syncFixtures("hoje");
  } catch (e) {
    console.error("auto-bilhete: falha ao sincronizar fixtures", e);
  }

  const lerPartidas = async () =>
    supabase
      .from("partidas")
      .select(
        "id, external_id, liga, time_casa, time_fora, inicio, status, odds(casa, mercado, selecao, valor, external_odd_id)",
      )
      .in("liga", LIGAS_FOCO)
      .or(`status.eq.ao_vivo,and(inicio.gte.${from},inicio.lte.${to})`)
      .order("inicio", { ascending: true })
      .limit(20);

  let { data: partidas } = await lerPartidas();
  let rows = (partidas ?? []) as PartidaRow[];

  if (!rows.length) {
    return { ok: true, tipo: cfg.tipo, jogosAnalisados: 0, picks: 0, motivo: "Nenhum jogo nas próximas 4h nas ligas principais." };
  }

  // 2) Busca odds reais (Betano) dos jogos sem odds dessa casa.
  const semOdds = rows.filter((r) => !r.odds.some((o) => normKey(o.casa) === normKey(CASA)));
  if (semOdds.length) {
    try {
      const gravadas = await syncOdds(
        semOdds.map((r) => ({
          id: r.id,
          external_id: r.external_id,
          time_casa: r.time_casa,
          time_fora: r.time_fora,
        })),
        CASA,
      );
      if (gravadas > 0) {
        const reload = await lerPartidas();
        if (reload.data?.length) rows = reload.data as PartidaRow[];
      }
    } catch (e) {
      console.error("auto-bilhete: falha ao sincronizar odds", e);
    }
  }

  // Odd elegível: casa correta, dentro da faixa por jogo e mercado permitido.
  const oddElegivel = (o: OddRow) =>
    normKey(o.casa) === normKey(CASA) &&
    o.valor >= cfg.oddMinJogo &&
    o.valor <= cfg.oddMaxJogo &&
    mercadoPermitido(cfg, o.mercado, o.selecao);

  // Só jogos que têm pelo menos uma odd elegível.
  const elegiveis = rows.filter((r) => r.odds.some(oddElegivel));
  if (elegiveis.length < cfg.minJogos) {
    return {
      ok: true,
      tipo: cfg.tipo,
      jogosAnalisados: rows.length,
      picks: 0,
      motivo: `Jogos elegíveis insuficientes (${elegiveis.length}) para ${cfg.tipo} (mín. ${cfg.minJogos}).`,
    };
  }

  // 3) Monta o texto e chama o Gemini.
  const jogosTexto = elegiveis
    .map((r) => {
      const jogo = `${r.time_casa} x ${r.time_fora}`;
      const odds = r.odds
        .filter(oddElegivel)
        .map((o) => `${o.mercado} - ${o.selecao}: @${o.valor.toFixed(2)}`)
        .join(" | ");
      return `- ${jogo} (${r.liga}, ${formatMatchDate(r.inicio)}): ${odds}`;
    })
    .join("\n");

  const faixaJogo =
    cfg.oddMaxJogo === Infinity
      ? `>= ${cfg.oddMinJogo.toFixed(2)}`
      : `entre ${cfg.oddMinJogo.toFixed(2)} e ${cfg.oddMaxJogo.toFixed(2)}`;
  const regraTotal =
    cfg.oddMinTotal > 1
      ? `A odd total (produto das odds) deve ficar ENTRE ${cfg.oddMinTotal.toFixed(2)} e ${cfg.oddMaxTotal.toFixed(2)}.`
      : `A odd total (produto das odds) deve ser <= ${cfg.oddMaxTotal.toFixed(2)}.`;

  const cabecalho =
    cfg.tipo === "super_multipla"
      ? `Você é um analista de apostas esportivas. Monte UMA "Super Múltipla": combine de ${cfg.minJogos} a ${cfg.maxJogos} jogos de ALTA CONFIANÇA para alcançar a odd total alvo.`
      : `Você é um analista de apostas esportivas. Monte UM ÚNICO bilhete múltiplo a partir das odds reais abaixo.`;

  const prompt = `${cabecalho}

REGRAS OBRIGATÓRIAS:
- Use SOMENTE seleções listadas abaixo (mesmo jogo, mercado, seleção).
- Cada seleção deve ter odd ${faixaJogo}.
- Use de ${cfg.minJogos} a ${cfg.maxJogos} jogos no bilhete (um jogo só pode aparecer uma vez).
- ${regraTotal}
- Priorize as entradas mais seguras e de maior confiança.

JOGOS E ODDS DISPONÍVEIS:
${jogosTexto}

Responda APENAS em JSON, sem texto fora do JSON:
{
  "resumo": "string curta",
  "risco": "baixo" | "medio" | "alto",
  "observacoes": "string",
  "picks": [
    { "jogo": "Time A x Time B", "mercado": "...", "selecao": "...", "confianca": 0-100, "justificativa": "..." }
  ]
}`;

  let raw: Record<string, unknown>;
  try {
    const { text } = await generateText({ model: getAiModel(), prompt });
    raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch (e) {
    console.error("auto-bilhete: falha na IA", e);
    return { ok: false, tipo: cfg.tipo, jogosAnalisados: elegiveis.length, picks: 0, motivo: "Falha ao gerar/parsear resposta da IA." };
  }

  // 4) Valida picks contra o banco e aplica as regras.
  const rawPicks = Array.isArray(raw.picks) ? (raw.picks as Record<string, unknown>[]) : [];
  const usados = new Set<string>();
  type Pick = {
    partida_id: string;
    jogo: string;
    mercado: string;
    selecao: string;
    odd: number;
    confianca: number;
    justificativa: string;
    external_odd_id: string | null;
  };
  const picks: Pick[] = [];

  for (const item of rawPicks) {
    const jogo = String(item.jogo ?? "").trim();
    const selecao = String(item.selecao ?? "").trim();
    if (!jogo || !selecao) continue;

    const partida = elegiveis.find((r) => normKey(`${r.time_casa} x ${r.time_fora}`) === normKey(jogo));
    if (!partida || usados.has(partida.id)) continue;

    const oddRow = partida.odds.find((o) => oddElegivel(o) && normKey(o.selecao) === normKey(selecao));
    if (!oddRow) continue;

    usados.add(partida.id);
    picks.push({
      partida_id: partida.id,
      jogo,
      mercado: oddRow.mercado,
      selecao: oddRow.selecao,
      odd: oddRow.valor,
      confianca: Math.max(0, Math.min(100, Number(item.confianca) || 60)),
      justificativa: String(item.justificativa ?? "Entrada baseada nas odds reais."),
      external_odd_id: oddRow.external_odd_id,
    });
    if (picks.length >= cfg.maxJogos) break;
  }

  const oddTotalDe = (arr: Pick[]) => arr.reduce((t, p) => t * p.odd, 1);
  // Maior confiança primeiro; remove as menos confiáveis até caber no teto.
  let escolhidos = [...picks].sort((a, b) => b.confianca - a.confianca);
  while (escolhidos.length > cfg.minJogos && oddTotalDe(escolhidos) > cfg.oddMaxTotal) {
    escolhidos.sort((a, b) => b.odd - a.odd);
    escolhidos.shift();
  }

  const oddTotalFinal = oddTotalDe(escolhidos);
  const dentroDasRegras =
    escolhidos.length >= cfg.minJogos &&
    escolhidos.length <= cfg.maxJogos &&
    oddTotalFinal >= cfg.oddMinTotal &&
    oddTotalFinal <= cfg.oddMaxTotal;

  if (!dentroDasRegras) {
    return {
      ok: true,
      tipo: cfg.tipo,
      jogosAnalisados: elegiveis.length,
      picks: 0,
      motivo: `Não foi possível montar ${cfg.tipo} dentro das regras (odd total ${oddTotalFinal.toFixed(2)}, ${escolhidos.length} jogos).`,
    };
  }

  const oddTotal = Number(oddTotalFinal.toFixed(2));
  const avg = escolhidos.reduce((s, p) => s + p.confianca, 0) / escolhidos.length;
  const risco: string =
    typeof raw.risco === "string" && ["baixo", "medio", "alto"].includes(raw.risco)
      ? (raw.risco as string)
      : cfg.tipo === "super_multipla"
        ? avg >= 80
          ? "medio"
          : "alto"
        : oddTotal <= 2.2 && avg >= 70
          ? "baixo"
          : avg < 55
            ? "alto"
            : "medio";

  const resumoPadrao =
    cfg.tipo === "super_multipla"
      ? `Super Múltipla (${escolhidos.length} jogos, odd total ${oddTotal}).`
      : `Bilhete automático (odd total ${oddTotal}).`;

  // 5) Salva bilhete + palpites.
  const { data: bilhete, error: errBilhete } = await supabase
    .from("bilhetes")
    .insert({
      resumo: String(raw.resumo ?? resumoPadrao),
      odd_total: oddTotal,
      risco,
      observacoes: String(raw.observacoes ?? "Odds reais da API-Football; podem variar até a confirmação na casa."),
      casa: CASA,
      periodo: "aovivo",
      tipo: cfg.tipo,
    })
    .select("id")
    .single();

  if (errBilhete || !bilhete) {
    console.error("auto-bilhete: erro ao salvar bilhete", errBilhete);
    return { ok: false, tipo: cfg.tipo, jogosAnalisados: elegiveis.length, picks: 0, motivo: "Erro ao salvar bilhete." };
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
    jogosAnalisados: elegiveis.length,
    picks: escolhidos.length,
    oddTotal,
  };
}

// Bilhete padrão (compatível com chamadas existentes).
export async function gerarBilheteAutomatico(): Promise<AutoResult> {
  return montarBilhete(CONFIG_PADRAO);
}

// Super Múltipla (4-5 jogos, odd total 15.00-30.00).
export async function gerarSuperMultipla(): Promise<AutoResult> {
  return montarBilhete(CONFIG_SUPER);
}

// Roda os dois tipos numa só passada do robô (usado pelo cron).
export async function gerarTodosBilhetes(): Promise<AutoResult[]> {
  const padrao = await gerarBilheteAutomatico();
  const superMultipla = await gerarSuperMultipla();
  return [padrao, superMultipla];
}

