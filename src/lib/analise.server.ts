// Análise por jogo com cache diário.
// A IA analisa cada jogo no máximo 1x por dia (por casa). O resultado é salvo
// em public.analise_cache e reaproveitado para jogos que ainda não começaram,
// evitando chamadas repetidas à IA no mesmo dia.
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { EstatisticasResumo } from "./football.server";

export type OddRow = {
  casa: string;
  mercado: string;
  selecao: string;
  valor: number;
  external_odd_id: string | null;
};

export type PartidaRow = {
  id: string;
  external_id: string | null;
  liga: string | null;
  time_casa: string;
  time_fora: string;
  inicio: string;
  status: string;
  arbitro?: string | null;
  odds: OddRow[];
  estatisticas?: EstatisticasResumo | null;
};


export type PickAnalise = {
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
  justificativa: string;
  external_odd_id: string | null;
};

export type AnaliseJogoStats = {
  escanteios: string;
  gols: string;
  chutesAoGol: string;
  cartoesTimes: string;
  cartoesArbitro: string;
};

export type AnalisePartida = {
  picks: PickAnalise[];
  analise: AnaliseJogoStats;
};

function normKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractJson(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON não encontrado");
  return cleaned.slice(start, end + 1);
}

function repairJson(input: string) {
  let s = input.replace(/,\s*([}\]])/g, "$1");
  const opens: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") opens.push(ch);
    else if (ch === "}" || ch === "]") opens.pop();
  }
  if (inString) s += '"';
  while (opens.length) {
    const o = opens.pop();
    s += o === "{" ? "}" : "]";
  }
  return s.replace(/,\s*([}\]])/g, "$1");
}

function parseAiJson(text: string): Record<string, unknown> {
  const extracted = extractJson(text);
  try {
    return JSON.parse(extracted) as Record<string, unknown>;
  } catch {
    return JSON.parse(repairJson(extracted)) as Record<string, unknown>;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /too many requests|rate limit|resource_exhausted|429/i.test(msg);
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

function traduzSelecaoCache(selecao: string) {
  return selecao
    .replace(/\bOver\s*([0-9.]+)?/gi, (_m, n) => `Mais de${n ? ` ${n}` : ""}`)
    .replace(/\bUnder\s*([0-9.]+)?/gi, (_m, n) => `Menos de${n ? ` ${n}` : ""}`)
    .replace(/\bDraw\b/gi, "Empate")
    .replace(/\bYes\b/gi, "Sim")
    .replace(/\bNo\b/gi, "Não");
}

function confiancaPorOddSegura(odd: number) {
  if (odd <= 1.35) return 94;
  if (odd <= 1.6) return 92;
  if (odd <= 1.9) return 90;
  return 88;
}

function normalizarAnaliseCache(payload: AnalisePartida): AnalisePartida {
  return {
    ...payload,
    picks: (payload.picks ?? []).map((p) => {
      const fallbackPorLimite = /limite tempor[aá]rio|odds reais salvas/i.test(p.justificativa ?? "");
      return {
        ...p,
        selecao: traduzSelecaoCache(p.selecao),
        confianca: fallbackPorLimite ? Math.max(p.confianca ?? 0, confiancaPorOddSegura(Number(p.odd) || 0)) : p.confianca,
      };
    }),
  };
}

// Chama a IA para analisar UM jogo a partir das odds reais da casa.
async function analisarComIa(model: LanguageModel, partida: PartidaRow, casa: string): Promise<AnalisePartida> {
  const oddsCasa = partida.odds.filter((o) => normKey(o.casa) === normKey(casa));
  const oddsTxt = oddsCasa.map((o) => `${o.mercado} / ${o.selecao} @ ${o.valor}`).join("; ");
  const jogo = `${partida.time_casa} x ${partida.time_fora}`;

  const system = `Você é um analista esportivo de futebol especializado em apostas.
Analise UM único jogo e recomende as melhores seleções para apostar, usando SOMENTE as odds reais listadas (casa "${casa}").
Regras:
- Use exatamente o mercado/seleção/odd da lista. Nunca invente seleções nem odds.
- Baseie a confiança e as justificativas nas ESTATÍSTICAS REAIS fornecidas (forma recente dos últimos 10, médias de gols feitos/sofridos, probabilidades, tendência de gols e média de cartões do confronto). Se não houver estatísticas, use apenas as odds.
- Para cada seleção recomendada informe a confiança real (0 a 100) e uma justificativa curta em português citando os números reais.
- Recomende de 1 a 5 seleções, das mais seguras para as mais arriscadas.
- Nunca recomende seleções contraditórias do mesmo mercado.
- Nas estatísticas do jogo (escanteios, gols, chutes ao gol, cartões) prefira os números reais fornecidos; só estime o que não estiver disponível.`;

  const est = partida.estatisticas;
  const estTxt = est
    ? `Estatísticas reais (API-Football):
- Forma recente (últimos 10): ${partida.time_casa} ${est.formaCasa ?? "?"} / ${partida.time_fora} ${est.formaFora ?? "?"}
- Gols feitos (média): ${partida.time_casa} ${est.golsFeitosCasa ?? "?"} / ${partida.time_fora} ${est.golsFeitosFora ?? "?"}
- Gols sofridos (média): ${partida.time_casa} ${est.golsSofridosCasa ?? "?"} / ${partida.time_fora} ${est.golsSofridosFora ?? "?"}
- Probabilidade (casa/empate/fora): ${est.percent.casa ?? "?"} / ${est.percent.empate ?? "?"} / ${est.percent.fora ?? "?"}
- Gols previstos: ${partida.time_casa} ${est.golsPrev.casa ?? "?"} / ${partida.time_fora} ${est.golsPrev.fora ?? "?"}
- Tendência de gols: ${est.underOver ?? "?"}
- Média de cartões por time: ${partida.time_casa} ${est.cartoesCasa ?? "?"} / ${partida.time_fora} ${est.cartoesFora ?? "?"}
- Média de cartões no confronto: ${est.cartoesConfronto ?? "?"}`
    : "Estatísticas reais: não disponíveis para este jogo.";

  const prompt = `Jogo: ${jogo}${partida.liga ? ` | ${partida.liga}` : ""}
Início: ${formatMatchDate(partida.inicio)}
${estTxt}
Odds disponíveis (${casa}): ${oddsTxt}

Responda SOMENTE com JSON válido neste formato:
{
  "picks": [{ "mercado": "mercado", "selecao": "seleção", "odd": 1.85, "confianca": 78, "justificativa": "motivo curto" }],
  "analise": { "escanteios": "média ~9.5, linha +8.5", "gols": "média 2.7 gols", "chutesAoGol": "Casa 5.2 / Fora 4.1", "cartoesTimes": "Casa 2.1 / Fora 1.8", "cartoesArbitro": "árbitro média 4.3 cartões/jogo" }
}`;


  const { text } = await generateText({
    model,
    system,
    prompt,
    temperature: 0.2,
    maxOutputTokens: 1200,
  });

  const raw = parseAiJson(text);
  const rawPicks = Array.isArray(raw.picks) ? raw.picks : [];

  const picks: PickAnalise[] = [];
  const usados = new Set<string>();
  for (const item of rawPicks) {
    const p = item as Record<string, unknown>;
    const mercado = toText(p.mercado ?? p.market, "");
    const selecao = toText(p.selecao ?? p.palpite ?? p.selection, "");
    if (!selecao) continue;
    // Casa com a odd real do banco. Primeiro tenta correspondência exata; se
    // não achar (ex.: a IA escreveu "Vitória do Brasil" e a odd é "Brazil"),
    // tenta correspondência parcial pelo mercado + seleção.
    const selKey = normKey(selecao);
    const merKey = normKey(mercado);
    let oddRow = oddsCasa.find((o) => normKey(o.selecao) === selKey);
    if (!oddRow) {
      oddRow = oddsCasa.find((o) => {
        const os = normKey(o.selecao);
        const om = normKey(o.mercado);
        const selMatch = os.includes(selKey) || selKey.includes(os);
        const merMatch = !merKey || om.includes(merKey) || merKey.includes(om);
        return selMatch && merMatch;
      });
    }
    if (!oddRow) continue;
    const chave = normKey(`${oddRow.mercado} ${oddRow.selecao}`);
    if (usados.has(chave)) continue;
    usados.add(chave);
    picks.push({
      mercado: oddRow.mercado || mercado || "Resultado Final",
      selecao: oddRow.selecao,
      odd: oddRow.valor,
      confianca: Math.max(0, Math.min(100, toNumber(p.confianca ?? p.confidence, 60))),
      justificativa: toText(p.justificativa ?? p.analise, "Escolha baseada nas odds reais."),
      external_odd_id: oddRow.external_odd_id,
    });
  }

  const a = (raw.analise ?? {}) as Record<string, unknown>;
  const real = analiseDeEstatisticas(partida);
  const semDados = /^sem dados|^aguardando/i;
  const pick = (v: unknown, r: string) => {
    const t = toText(v, "");
    return t && !semDados.test(t) ? t : r;
  };
  const analise: AnaliseJogoStats = {
    escanteios: pick(a.escanteios ?? a.corners, real.escanteios),
    gols: pick(a.gols ?? a.goals, real.gols),
    chutesAoGol: pick(a.chutesAoGol ?? a.chutes ?? a.shotsOnTarget, real.chutesAoGol),
    cartoesTimes: pick(a.cartoesTimes ?? a.cartoes, real.cartoesTimes),
    cartoesArbitro: pick(a.cartoesArbitro ?? a.arbitro, real.cartoesArbitro),
  };

  return { picks, analise };
}

// Monta as estatísticas do jogo (escanteios, gols, chutes, cartões) a partir
// dos números REAIS da API-Football (tabela estatisticas). É usado quando a IA
// não está disponível (limite atingido) e para preencher o que a IA deixar vazio.
export function analiseDeEstatisticas(partida: PartidaRow): AnaliseJogoStats {
  const est = partida.estatisticas;
  const casa = partida.time_casa;
  const fora = partida.time_fora;
  const pend = (o: string) => `Aguardando nova análise da IA para ${o}.`;

  if (!est) {
    return {
      escanteios: pend("estatísticas de escanteios"),
      gols: pend("estatísticas de gols"),
      chutesAoGol: pend("chutes ao gol"),
      cartoesTimes: pend("cartões dos times"),
      cartoesArbitro: pend("cartões do árbitro"),
    };
  }

  const gCasa = toNumber(est.golsFeitosCasa, NaN);
  const gFora = toNumber(est.golsFeitosFora, NaN);
  const sCasa = toNumber(est.golsSofridosCasa, NaN);
  const sFora = toNumber(est.golsSofridosFora, NaN);

  const golsPartes: string[] = [];
  if (Number.isFinite(gCasa) || Number.isFinite(sCasa))
    golsPartes.push(`${casa}: ${Number.isFinite(gCasa) ? gCasa.toFixed(1) : "?"} feitos / ${Number.isFinite(sCasa) ? sCasa.toFixed(1) : "?"} sofridos`);
  if (Number.isFinite(gFora) || Number.isFinite(sFora))
    golsPartes.push(`${fora}: ${Number.isFinite(gFora) ? gFora.toFixed(1) : "?"} feitos / ${Number.isFinite(sFora) ? sFora.toFixed(1) : "?"} sofridos`);
  if (est.underOver) golsPartes.push(`tendência ${est.underOver}`);
  const gols = golsPartes.length ? golsPartes.join(" · ") : "Sem dados de gols.";

  // Chutes ao gol não vêm do endpoint de predições: estimamos a partir da
  // média de gols feitos (aprox. 3 chutes no gol por gol marcado).
  const chutesCasa = Number.isFinite(gCasa) ? (gCasa * 3).toFixed(1) : null;
  const chutesFora = Number.isFinite(gFora) ? (gFora * 3).toFixed(1) : null;
  const chutesAoGol =
    chutesCasa || chutesFora
      ? `${casa} ~${chutesCasa ?? "?"} / ${fora} ~${chutesFora ?? "?"} (estimativa)`
      : "Sem dados de chutes ao gol.";

  // Escanteios também não vêm nas predições: estimativa baseada no volume
  // ofensivo total esperado (gols feitos + sofridos dos dois lados).
  const totalGols = [gCasa, gFora, sCasa, sFora].filter((n) => Number.isFinite(n)) as number[];
  const escanteios =
    totalGols.length >= 2
      ? (() => {
          const media = totalGols.reduce((a, b) => a + b, 0) / totalGols.length;
          const linha = Math.max(6, Math.round(media * 3 + 4));
          return `estimativa ~${linha} no jogo, linha +${(linha - 0.5).toFixed(1)}`;
        })()
      : "Sem dados de escanteios.";

  const cartoesTimes =
    est.cartoesCasa || est.cartoesFora
      ? `${casa} ${est.cartoesCasa ?? "?"} / ${fora} ${est.cartoesFora ?? "?"} cartões por jogo`
      : "Sem dados de cartões dos times.";

  // Fallback do árbitro: quando a partida não tem árbitro escalado (campo nulo
  // ou vazio), o peso analítico de cartões vai INTEIRAMENTE para a média das
  // duas equipes — ignoramos a variável do árbitro nesse cenário.
  const semArbitro = !partida.arbitro || !String(partida.arbitro).trim();
  const cartoesArbitro = semArbitro
    ? est.cartoesCasa || est.cartoesFora
      ? `Árbitro não escalado — baseado só na média dos times (${casa} ${est.cartoesCasa ?? "?"} / ${fora} ${est.cartoesFora ?? "?"} cartões/jogo)`
      : "Árbitro não escalado — sem histórico de cartões dos times."
    : est.cartoesConfronto
      ? `média do confronto ${est.cartoesConfronto} cartões/jogo`
      : "Sem dados do árbitro.";

  return { escanteios, gols, chutesAoGol, cartoesTimes, cartoesArbitro };
}

function montarAnaliseSemIa(partida: PartidaRow, casa: string): AnalisePartida {
  const oddsCasa = partida.odds
    .filter((o) => normKey(o.casa) === normKey(casa) && o.valor >= 1.2 && o.valor <= 4.5)
    .sort((a, b) => a.valor - b.valor)
    .slice(0, 5);

  return {
    picks: oddsCasa.map((o) => ({
      mercado: o.mercado || "Resultado Final",
      selecao: traduzSelecaoCache(o.selecao),
      odd: o.valor,
      confianca: confiancaPorOddSegura(o.valor),
      justificativa: "",
      external_odd_id: o.external_odd_id,
    })),
    analise: analiseDeEstatisticas(partida),
  };
}

// Calcula o dia (America/Sao_Paulo) no formato YYYY-MM-DD.
export function diaSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Retorna a análise do jogo: do cache (se existir para o dia) ou gera com a IA e salva.
// Quando `somenteCache` é true (fluxo do cliente), NUNCA chama a IA: só lê o
// cache já preenchido pelo robô a cada 5 min. Se não houver cache, retorna vazio.
export async function obterAnalisePartida(
  supabaseAdmin: any,
  model: LanguageModel,
  partida: PartidaRow,
  casa: string,
  dia: string,
  somenteCache = false,
): Promise<AnalisePartida> {
  // 1) Tenta o cache do dia.
  const { data: cached } = await supabaseAdmin
    .from("analise_cache")
    .select("payload")
    .eq("partida_id", partida.id)
    .eq("dia", dia)
    .eq("casa", casa)
    .maybeSingle();

  if (cached?.payload) {
    const payload = normalizarAnaliseCache(cached.payload as AnalisePartida);
    if (Array.isArray(payload.picks) && payload.picks.length) {
      return payload;
    }
  }

  // Fallback: como as odds são compartilhadas entre as casas (consenso), uma
  // análise já feita para QUALQUER casa do mesmo jogo/dia serve para a casa
  // selecionada. Assim o robô só precisa analisar cada jogo uma vez.
  {
    const { data: outra } = await supabaseAdmin
      .from("analise_cache")
      .select("payload")
      .eq("partida_id", partida.id)
      .eq("dia", dia)
      .limit(1)
      .maybeSingle();
    if (outra?.payload) {
      const payload = normalizarAnaliseCache(outra.payload as AnalisePartida);
      if (Array.isArray(payload.picks) && payload.picks.length) {
        return payload;
      }
    }
  }

  // Fluxo do cliente: não gera com IA, apenas usa o que o robô já salvou.
  if (somenteCache) {
    return { picks: [], analise: montarAnaliseSemIa(partida, casa).analise };
  }

  // 2) Sem cache válido: chama a IA e salva.
  let analise: AnalisePartida;
  try {
    analise = await analisarComIa(model, partida, casa);
  } catch (e) {
    if (!isRateLimitError(e)) throw e;
    analise = montarAnaliseSemIa(partida, casa);
  }
  if (analise.picks.length) {
    try {
      await supabaseAdmin
        .from("analise_cache")
        .upsert({ partida_id: partida.id, dia, casa, payload: analise }, { onConflict: "partida_id,dia,casa" });
    } catch (e) {
      console.error("Falha ao salvar análise no cache", e);
    }
  }
  return analise;
}

// Roda várias análises com concorrência limitada (evita estourar a IA).
// Retorna também os erros coletados para que a camada acima possa diferenciar
// "nenhuma entrada" de "a IA falhou em todos os jogos".
export async function analisarPartidas(
  supabaseAdmin: any,
  model: LanguageModel,
  partidas: PartidaRow[],
  casa: string,
  dia: string,
  concorrencia = 4,
  somenteCache = false,
): Promise<{ resultado: Map<string, AnalisePartida>; erros: string[]; falhas: number }> {
  const resultado = new Map<string, AnalisePartida>();
  const erros: string[] = [];
  let falhas = 0;
  let i = 0;
  async function worker() {
    while (i < partidas.length) {
      const idx = i++;
      const partida = partidas[idx];
      try {
        if (idx > 0 && !somenteCache) await sleep(1200);
        const analise = await obterAnalisePartida(supabaseAdmin, model, partida, casa, dia, somenteCache);
        if (analise.picks.length) resultado.set(partida.id, analise);
      } catch (e) {
        falhas++;
        const msg = e instanceof Error ? e.message : String(e);
        if (erros.length < 3) erros.push(msg);
        console.error("Falha ao analisar partida", partida.id, e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, partidas.length) }, worker));
  return { resultado, erros, falhas };
}
