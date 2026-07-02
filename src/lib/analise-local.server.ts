// Motor de análise 100% LOCAL (sem IA).
// Calcula as probabilidades reais de cada mercado a partir das estatísticas da
// API-Football (médias de gols, forma, probabilidades) usando o modelo de
// Poisson, e escolhe as seleções com maior chance/valor sobre as odds salvas.
// Determinístico, gratuito e sem depender de nenhuma chamada externa.
import type { AnalisePartida, AnaliseJogoStats, PartidaRow, PickAnalise } from "./analise.server";
import { analiseDeEstatisticas } from "./analise.server";

function normKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function num(value: unknown, fallback = NaN): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- Poisson ----------
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

// P(X <= k)
function poissonCdf(lambda: number, k: number): number {
  let acc = 0;
  for (let i = 0; i <= k; i++) acc += poissonPmf(lambda, i);
  return Math.min(1, acc);
}

// P(total > linha), ex.: linha 2.5 => P(>=3) = 1 - P(<=2)
function probOver(lambda: number, linha: number): number {
  return clamp(1 - poissonCdf(lambda, Math.floor(linha)), 0, 1);
}
function probUnder(lambda: number, linha: number): number {
  return clamp(poissonCdf(lambda, Math.floor(linha)), 0, 1);
}

// Extrai o primeiro número (linha) de uma seleção, ex.: "Mais de 2.5" => 2.5.
function extrairLinha(selecao: string): number | null {
  const m = selecao.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------- Contexto probabilístico do jogo ----------
interface Contexto {
  lambdaCasa: number;
  lambdaFora: number;
  lambdaTotal: number;
  pCasa: number;
  pEmpate: number;
  pFora: number;
  pCasa0: number; // P(casa não marca)
  pFora0: number; // P(fora não marca)
  bttsSim: number;
  lambda1t: number;
  lambdaEscanteios: number;
  lambdaCartoes: number;
}

function pct(value: unknown): number | null {
  const n = num(value, NaN);
  if (!Number.isFinite(n)) return null;
  return clamp(n / 100, 0, 1);
}

function montarContexto(partida: PartidaRow): Contexto | null {
  const est = partida.estatisticas;
  if (!est) return null;

  const gfCasa = num(est.golsFeitosCasa);
  const gsCasa = num(est.golsSofridosCasa);
  const gfFora = num(est.golsFeitosFora);
  const gsFora = num(est.golsSofridosFora);
  const prevCasa = num(est.golsPrev?.casa);
  const prevFora = num(est.golsPrev?.fora);

  // Gols esperados de cada lado: usa o previsto quando existir; senão a média
  // entre o ataque de um time e a defesa do adversário.
  let lambdaCasa = Number.isFinite(prevCasa) ? prevCasa : NaN;
  if (!Number.isFinite(lambdaCasa)) {
    const a = Number.isFinite(gfCasa) ? gfCasa : NaN;
    const b = Number.isFinite(gsFora) ? gsFora : NaN;
    lambdaCasa = Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : NaN;
  }
  let lambdaFora = Number.isFinite(prevFora) ? prevFora : NaN;
  if (!Number.isFinite(lambdaFora)) {
    const a = Number.isFinite(gfFora) ? gfFora : NaN;
    const b = Number.isFinite(gsCasa) ? gsCasa : NaN;
    lambdaFora = Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : Number.isFinite(a) ? a : NaN;
  }

  // Sem nenhum dado de gols não há como calcular localmente.
  if (!Number.isFinite(lambdaCasa) && !Number.isFinite(lambdaFora)) return null;
  lambdaCasa = clamp(Number.isFinite(lambdaCasa) ? lambdaCasa : 1.2, 0.15, 4.5);
  lambdaFora = clamp(Number.isFinite(lambdaFora) ? lambdaFora : 1.0, 0.15, 4.5);

  // Desfalques (lesões/suspensões): cada ausência reduz o poder de ataque do
  // time. Penalidade limitada a ~28% para não zerar o modelo. Tratado 100% local.
  const nLesCasa = Array.isArray(est.lesoesCasa) ? est.lesoesCasa.length : 0;
  const nLesFora = Array.isArray(est.lesoesFora) ? est.lesoesFora.length : 0;
  const penalDesfalque = (n: number) => clamp(1 - 0.035 * n, 0.72, 1);
  lambdaCasa *= penalDesfalque(nLesCasa);
  lambdaFora *= penalDesfalque(nLesFora);

  const lambdaTotal = lambdaCasa + lambdaFora;

  // 1X2: usa as probabilidades da API quando existirem; senão calcula pela
  // distribuição conjunta de Poisson (placar até 8x8).
  let pCasa = pct(est.percent?.casa);
  let pEmpate = pct(est.percent?.empate);
  let pFora = pct(est.percent?.fora);
  if (pCasa == null || pEmpate == null || pFora == null) {
    let ph = 0, pd = 0, pa = 0;
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const p = poissonPmf(lambdaCasa, i) * poissonPmf(lambdaFora, j);
        if (i > j) ph += p;
        else if (i === j) pd += p;
        else pa += p;
      }
    }
    pCasa = ph;
    pEmpate = pd;
    pFora = pa;
  }
  const soma = (pCasa ?? 0) + (pEmpate ?? 0) + (pFora ?? 0) || 1;
  pCasa = (pCasa ?? 0) / soma;
  pEmpate = (pEmpate ?? 0) / soma;
  pFora = (pFora ?? 0) / soma;

  const pCasa0 = poissonPmf(lambdaCasa, 0);
  const pFora0 = poissonPmf(lambdaFora, 0);
  const bttsSim = (1 - pCasa0) * (1 - pFora0);

  // Escanteios ~ cresce com o volume ofensivo total. Cartões ~ média do
  // confronto (ou média dos dois times) quando disponível.
  const lambdaEscanteios = clamp(7.5 + lambdaTotal, 8, 12.5);
  const cConf = num(est.cartoesConfronto);
  const cCasa = num(est.cartoesCasa);
  const cFora = num(est.cartoesFora);
  let lambdaCartoes = Number.isFinite(cConf) ? cConf : NaN;
  if (!Number.isFinite(lambdaCartoes)) {
    if (Number.isFinite(cCasa) && Number.isFinite(cFora)) lambdaCartoes = cCasa + cFora;
    else if (Number.isFinite(cCasa)) lambdaCartoes = cCasa * 2;
    else if (Number.isFinite(cFora)) lambdaCartoes = cFora * 2;
    else lambdaCartoes = 4.2;
  }
  lambdaCartoes = clamp(lambdaCartoes, 2, 8);

  return {
    lambdaCasa,
    lambdaFora,
    lambdaTotal,
    pCasa,
    pEmpate,
    pFora,
    pCasa0,
    pFora0,
    bttsSim,
    lambda1t: lambdaTotal * 0.45,
    lambdaEscanteios,
    lambdaCartoes,
  };
}

// Devolve a probabilidade (0-1) do modelo para uma seleção específica, ou null
// se o mercado não for suportado localmente.
function probDaSelecao(
  mercado: string,
  selecao: string,
  ctx: Contexto,
  casa: string,
  fora: string,
): number | null {
  const m = normKey(mercado);
  const s = normKey(selecao);
  const kCasa = normKey(casa);
  const kFora = normKey(fora);
  const temCasa = kCasa && s.includes(kCasa);
  const temFora = kFora && s.includes(kFora);
  const temEmpate = s.includes("empate");
  const isOver = s.includes("mais de");
  const isUnder = s.includes("menos de");

  // Resultado Final (1X2)
  if (m.includes("resultado")) {
    if (temEmpate) return ctx.pEmpate;
    if (temCasa) return ctx.pCasa;
    if (temFora) return ctx.pFora;
    return null;
  }

  // Dupla Chance
  if (m.includes("dupla chance")) {
    if (temCasa && temEmpate) return ctx.pCasa + ctx.pEmpate;
    if (temEmpate && temFora) return ctx.pEmpate + ctx.pFora;
    if (temCasa && temFora) return ctx.pCasa + ctx.pFora;
    return null;
  }

  // Empate Anula (DNB)
  if (m.includes("dnb") || m.includes("empate anula")) {
    const base = ctx.pCasa + ctx.pFora || 1;
    if (temCasa) return ctx.pCasa / base;
    if (temFora) return ctx.pFora / base;
    return null;
  }

  // Ambas Marcam
  if (m.includes("ambas")) {
    if (s.includes("sim")) return ctx.bttsSim;
    if (s.includes("nao")) return 1 - ctx.bttsSim;
    return null;
  }

  // Time Marca Gol
  if (m.includes("marca gol") || m.includes("marca")) {
    if (temCasa) return 1 - ctx.pCasa0;
    if (temFora) return 1 - ctx.pFora0;
    if (s.includes("sim")) return ctx.bttsSim;
    if (s.includes("nao")) return 1 - ctx.bttsSim;
    return null;
  }

  // Gols no 1º Tempo
  if (m.includes("1") && m.includes("tempo")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver) return probOver(ctx.lambda1t, linha);
    if (isUnder) return probUnder(ctx.lambda1t, linha);
    return null;
  }

  // Total de Gols
  if (m.includes("total de gols") || (m.includes("gols") && (isOver || isUnder))) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver) return probOver(ctx.lambdaTotal, linha);
    if (isUnder) return probUnder(ctx.lambdaTotal, linha);
    return null;
  }

  // Escanteios
  if (m.includes("escanteio")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver) return probOver(ctx.lambdaEscanteios, linha);
    if (isUnder) return probUnder(ctx.lambdaEscanteios, linha);
    return null;
  }

  // Cartões
  if (m.includes("cart")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver) return probOver(ctx.lambdaCartoes, linha);
    if (isUnder) return probUnder(ctx.lambdaCartoes, linha);
    return null;
  }

  return null;
}

function confiancaPorOddSegura(odd: number) {
  if (odd <= 1.35) return 94;
  if (odd <= 1.6) return 92;
  if (odd <= 1.9) return 90;
  if (odd <= 2.3) return 84;
  return 78;
}

// Fallback sem estatísticas: usa as próprias odds (favoritos = mais chance).
function picksSoOdds(partida: PartidaRow, casa: string): PickAnalise[] {
  return partida.odds
    .filter((o) => normKey(o.casa) === normKey(casa) && o.valor >= 1.2 && o.valor <= 4.5)
    .sort((a, b) => a.valor - b.valor)
    .slice(0, 5)
    .map((o) => ({
      mercado: o.mercado || "Resultado Final",
      selecao: o.selecao,
      odd: o.valor,
      confianca: confiancaPorOddSegura(o.valor),
      justificativa: `Análise local pelas odds: favorito com odd ${o.valor.toFixed(2)} (chance implícita ${Math.round((1 / o.valor) * 100)}%).`,
      external_odd_id: o.external_odd_id,
    }));
}

/**
 * Análise 100% local de UM jogo. Usa Poisson + estatísticas reais para calcular
 * a chance de cada seleção sobre as odds salvas da casa. Sem IA.
 */
export function analisarLocal(partida: PartidaRow, casa: string): AnalisePartida {
  const analise: AnaliseJogoStats = analiseDeEstatisticas(partida);
  const oddsCasa = partida.odds.filter((o) => normKey(o.casa) === normKey(casa));

  const ctx = montarContexto(partida);
  if (!ctx) {
    return { picks: picksSoOdds(partida, casa), analise };
  }

  type Cand = PickAnalise & { prob: number; valor: number };
  const porMercado = new Map<string, Cand>();

  for (const o of oddsCasa) {
    if (!Number.isFinite(o.valor) || o.valor < 1.15 || o.valor > 8) continue;
    const prob = probDaSelecao(o.mercado, o.selecao, ctx, partida.time_casa, partida.time_fora);
    if (prob == null || !Number.isFinite(prob) || prob <= 0) continue;

    const implicita = 1 / o.valor;
    const valor = prob - implicita; // valor esperado positivo = boa aposta
    const confianca = clamp(Math.round(prob * 100), 1, 99);
    const cand: Cand = {
      mercado: o.mercado || "Resultado Final",
      selecao: o.selecao,
      odd: o.valor,
      confianca,
      prob,
      valor,
      justificativa:
        `Modelo local (Poisson): chance ${Math.round(prob * 100)}% vs. odd ${o.valor.toFixed(2)} ` +
        `(implícita ${Math.round(implicita * 100)}%${valor > 0 ? `, valor +${Math.round(valor * 100)}%` : ""}). ` +
        `Gols esperados ${ctx.lambdaTotal.toFixed(1)} (${partida.time_casa} ${ctx.lambdaCasa.toFixed(1)} / ${partida.time_fora} ${ctx.lambdaFora.toFixed(1)}).`,
      external_odd_id: o.external_odd_id,
    };

    // Mantém a melhor seleção por mercado (evita over + under do mesmo mercado).
    const chave = normKey(cand.mercado);
    const atual = porMercado.get(chave);
    if (!atual || cand.prob > atual.prob) porMercado.set(chave, cand);
  }

  // Ordena por chance (mais seguras primeiro) e mantém as melhores.
  const picks = [...porMercado.values()]
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6)
    .map(({ prob, valor, ...p }) => p);

  if (!picks.length) return { picks: picksSoOdds(partida, casa), analise };
  return { picks, analise };
}
