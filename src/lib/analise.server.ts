// Análise por jogo com cache diário.
// O motor local analisa cada jogo e salva o resultado em public.analise_cache.
// O cliente nunca dispara análise externa: apenas lê o cache.
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


export type ValorLabel = "Excelente Valor" | "Bom Valor" | "Valor Moderado" | "Sem Valor";

export type PickAnalise = {
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
  justificativa: string;
  external_odd_id: string | null;
  // --- Campos opcionais do motor inteligente (retrocompatíveis) ---
  // Nenhum consumidor antigo depende deles; leitores novos podem usá-los.
  estrelas?: number; // 1 a 5 (classificação da pick)
  probModelo?: number; // 0-100 probabilidade do modelo (Poisson + fatores)
  oddJusta?: number; // 1 / probModelo
  evPct?: number; // valor esperado em % (prob*odd - 1) * 100
  valorLabel?: ValorLabel; // classificação do valor esperado
  motivos?: string[]; // justificativas geradas automaticamente
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




function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Monta as estatísticas do jogo (escanteios, gols, chutes, cartões) a partir
// dos números REAIS da API-Football (tabela estatisticas). É usado quando a IA
// não está disponível (limite atingido) e para preencher o que a IA deixar vazio.
export function analiseDeEstatisticas(partida: PartidaRow): AnaliseJogoStats {
  const est = partida.estatisticas;
  const casa = partida.time_casa;
  const fora = partida.time_fora;
  const pend = (o: string) => `Aguardando estatísticas reais para ${o}.`;

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

// Retorna a análise do jogo: do cache (se existir para o dia) ou gera localmente e salva.
// Quando `somenteCache` é true (fluxo do cliente), NUNCA recalcula: só lê o
// cache já preenchido pelo robô a cada 5 min. Se não houver cache, retorna vazio.
export async function obterAnalisePartida(
  supabaseAdmin: any,
  model: unknown | null,
  partida: PartidaRow,
  casa: string,
  dia: string,
  somenteCache = false,
  forcar = false,
): Promise<AnalisePartida> {
  // 1) Tenta o cache do dia (a menos que `forcar` peça reanálise).
  if (!forcar) {
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
  }

  // Fallback: como as odds são compartilhadas entre as casas (consenso), uma
  // análise já feita para QUALQUER casa do mesmo jogo/dia serve para a casa
  // selecionada. Assim o robô só precisa analisar cada jogo uma vez.
  if (!forcar) {
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

  // Fluxo do cliente: não recalcula, apenas usa o que o robô já salvou.
  if (somenteCache) {
    return { picks: [], analise: montarAnaliseSemIa(partida, casa).analise };
  }

  // 2) Sem cache válido: gera a análise 100% LOCAL (Poisson + estatísticas).
  // A IA não é mais usada — o motor local é determinístico e não depende de chave.
  let analise: AnalisePartida;
  try {
    const { analisarLocal } = await import("./analise-local.server");
    analise = analisarLocal(partida, casa);
    if (!analise.picks.length) analise = montarAnaliseSemIa(partida, casa);
  } catch (e) {
    console.error("Falha na análise local", e);
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

// Roda várias análises com concorrência limitada.
// Retorna também os erros coletados para que a camada acima possa diferenciar
// "nenhuma entrada" de "a análise falhou em todos os jogos".
export async function analisarPartidas(
  supabaseAdmin: any,
  model: unknown | null,
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
