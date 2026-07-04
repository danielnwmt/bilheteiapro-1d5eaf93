// Motor de análise 100% LOCAL e DETERMINÍSTICO (sem IA / sem LLM).
//
// Evolução do motor: além do modelo de Poisson sobre as odds reais salvas, agora
// calcula um SCORE DE CONFIANÇA composto por vários fatores ponderados (forma
// recente com peso por recência, força ofensiva/defensiva, casa x fora, lesões,
// qualidade e valor da odd, calibração por campeonato e importância do jogo),
// além do VALUE BET (valor esperado / odd justa), classificação por estrelas,
// filtros mais inteligentes e justificativas automáticas.
//
// Continua determinístico, gratuito, offline (após sincronizar dados) e usando
// SOMENTE estatísticas reais + odds reais. Nunca inventa mercados nem seleções.
import type {
  AnalisePartida,
  AnaliseJogoStats,
  PartidaRow,
  PickAnalise,
  ValorLabel,
} from "./analise.server";
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

// Uma linha de over/under só faz sentido se estiver perto da estimativa do jogo.
function linhaRelevante(isOver: boolean, linha: number, lambda: number): boolean {
  const margem = 2.5;
  if (isOver) return linha >= lambda - margem;
  return linha <= lambda + margem;
}

// Extrai o primeiro número (linha) de uma seleção, ex.: "Mais de 2.5" => 2.5.
function extrairLinha(selecao: string): number | null {
  const m = selecao.match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------- Calibração por campeonato (médias base) ----------
// Cada liga tem médias próprias de gols/escanteios/cartões. Quando faltam dados
// específicos do jogo, o modelo parte dessas bases (item 9 da especificação).
interface LigaCal {
  gols: number;
  escanteios: number;
  cartoes: number;
  // fator de "temperatura" competitiva (mata-mata / rivalidade tende a +cartões)
  intensidade: number;
}
const LIGA_PADRAO: LigaCal = { gols: 2.6, escanteios: 9.8, cartoes: 4.4, intensidade: 1 };
const LIGA_CAL: Array<{ re: RegExp; cal: LigaCal }> = [
  { re: /brasileir.*(serie a|a$)/, cal: { gols: 2.5, escanteios: 9.6, cartoes: 5.1, intensidade: 1.08 } },
  { re: /brasileir.*serie b/, cal: { gols: 2.3, escanteios: 9.2, cartoes: 5.3, intensidade: 1.1 } },
  { re: /copa do brasil/, cal: { gols: 2.4, escanteios: 9.4, cartoes: 5.4, intensidade: 1.15 } },
  { re: /libertadores/, cal: { gols: 2.5, escanteios: 9.8, cartoes: 5.6, intensidade: 1.18 } },
  { re: /sul ?americana|sudamericana/, cal: { gols: 2.4, escanteios: 9.5, cartoes: 5.5, intensidade: 1.15 } },
  { re: /premier league/, cal: { gols: 2.8, escanteios: 10.6, cartoes: 3.8, intensidade: 1 } },
  { re: /la ?liga/, cal: { gols: 2.5, escanteios: 9.9, cartoes: 4.9, intensidade: 1.05 } },
  { re: /serie a.*ital|serie a$/, cal: { gols: 2.7, escanteios: 10.1, cartoes: 4.6, intensidade: 1.03 } },
  { re: /bundesliga/, cal: { gols: 3.1, escanteios: 10.2, cartoes: 3.6, intensidade: 1 } },
  { re: /ligue 1/, cal: { gols: 2.6, escanteios: 9.9, cartoes: 4.2, intensidade: 1.02 } },
  { re: /champions/, cal: { gols: 2.8, escanteios: 10.4, cartoes: 4.0, intensidade: 1.12 } },
  { re: /europa league/, cal: { gols: 2.7, escanteios: 10.2, cartoes: 4.3, intensidade: 1.08 } },
  { re: /conference/, cal: { gols: 2.8, escanteios: 10.0, cartoes: 4.2, intensidade: 1.06 } },
  { re: /copa do mundo|world cup/, cal: { gols: 2.6, escanteios: 9.8, cartoes: 4.4, intensidade: 1.2 } },
];
function calibracaoLiga(liga: string | null): LigaCal {
  const k = normKey(liga ?? "");
  if (!k) return LIGA_PADRAO;
  const found = LIGA_CAL.find((x) => x.re.test(k));
  return found ? found.cal : LIGA_PADRAO;
}

// ---------- Importância do jogo (item 7) ----------
// Detecta contexto de maior peso a partir da liga. Sem dados de rodada/tabela,
// usamos o tipo de competição (mata-mata, copa, decisão) — determinístico.
function importanciaJogo(liga: string | null): { peso: number; rotulo: string | null } {
  const k = normKey(liga ?? "");
  if (/copa do mundo|world cup/.test(k)) return { peso: 1.2, rotulo: "Copa do Mundo (alta importância)" };
  if (/libertadores|champions/.test(k)) return { peso: 1.15, rotulo: "Competição continental de elite" };
  if (/copa do brasil|sul ?americana|sudamericana|europa league|conference/.test(k))
    return { peso: 1.1, rotulo: "Mata-mata / copa" };
  return { peso: 1, rotulo: null };
}

// ---------- Forma recente com peso por recência (item 3) ----------
// A string de forma vem com o jogo MAIS RECENTE por último (ex.: "LWWDW").
// Pesos: últimos 3 = 1.0, jogos 4-6 = 0.7, 7-10 = 0.4.
function formaPonderada(forma: string | null | undefined): { taxa: number; jogos: number } | null {
  if (!forma) return null;
  const chars = forma.toUpperCase().replace(/[^WDL]/g, "").split("");
  if (!chars.length) return null;
  const recentes = chars.slice(-10);
  let somaPeso = 0;
  let somaPts = 0;
  const n = recentes.length;
  for (let i = 0; i < n; i++) {
    const desdeFim = n - 1 - i; // 0 = mais recente
    const peso = desdeFim < 3 ? 1.0 : desdeFim < 6 ? 0.7 : 0.4;
    const pts = recentes[i] === "W" ? 1 : recentes[i] === "D" ? 0.5 : 0;
    somaPeso += peso;
    somaPts += pts * peso;
  }
  if (somaPeso <= 0) return null;
  return { taxa: clamp(somaPts / somaPeso, 0, 1), jogos: n };
}

function pct(value: unknown): number | null {
  const n = num(value, NaN);
  if (!Number.isFinite(n)) return null;
  return clamp(n / 100, 0, 1);
}

function mediaFinita(values: number[], fallback: number): number {
  const validos = values.filter((v) => Number.isFinite(v));
  if (!validos.length) return fallback;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function desvioRelativo(values: number[]): number {
  const validos = values.filter((v) => Number.isFinite(v));
  if (validos.length < 2) return 0;
  const m = validos.reduce((a, b) => a + b, 0) / validos.length;
  if (m <= 0) return 0;
  const variancia = validos.reduce((a, b) => a + (b - m) ** 2, 0) / validos.length;
  return Math.sqrt(variancia) / m;
}

function contemQualquer(texto: string, termos: string[]) {
  return termos.some((t) => texto.includes(t));
}

// ---------- Contexto probabilístico do jogo ----------
interface Contexto {
  lambdaCasa: number;
  lambdaFora: number;
  lambdaTotal: number;
  pCasa: number;
  pEmpate: number;
  pFora: number;
  pCasa0: number;
  pFora0: number;
  bttsSim: number;
  lambda1t: number;
  lambdaEscanteios: number;
  lambdaCartoes: number;
  // Fatores de apoio ao score de confiança:
  formaCasa: number | null; // 0-1 (peso por recência)
  formaFora: number | null;
  nLesCasa: number;
  nLesFora: number;
  cal: LigaCal;
  importancia: { peso: number; rotulo: string | null };
  escalacaoConfirmada: boolean;
  atkCasa: number; // gols feitos casa (média)
  atkFora: number;
  defCasa: number; // gols sofridos casa
  defFora: number;
  forcaCasa: number;
  forcaFora: number;
  qualidadeDados: number; // 0-100: quanto maior, mais confiável o score
  variacaoGols: number; // dispersão simples para penalizar jogos muito instáveis
}

function montarContexto(partida: PartidaRow): Contexto | null {
  const est = partida.estatisticas;
  const cal = calibracaoLiga(partida.liga);
  const importancia = importanciaJogo(partida.liga);
  if (!est) return null;

  const gfCasa = num(est.golsFeitosCasa);
  const gsCasa = num(est.golsSofridosCasa);
  const gfFora = num(est.golsFeitosFora);
  const gsFora = num(est.golsSofridosFora);

  // predictions.goals da API é um handicap, não gol esperado: só aceitamos se
  // for plausível. Senão usamos ataque de um time + defesa do adversário
  // (separando explicitamente desempenho de mandante e visitante — item 4).
  const prevCasaRaw = num(est.golsPrev?.casa);
  const prevForaRaw = num(est.golsPrev?.fora);
  const golPrevOk = (n: number) => Number.isFinite(n) && n >= 0.2 && n <= 5;

  const mediaGols = (ataque: number, defesa: number, base: number) => {
    const a = Number.isFinite(ataque) ? ataque : NaN;
    const b = Number.isFinite(defesa) ? defesa : NaN;
    if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
    if (Number.isFinite(a)) return a;
    if (Number.isFinite(b)) return b;
    return base; // cai na média do campeonato quando não há dado
  };

  const baseLado = cal.gols / 2;
  let lambdaCasa = golPrevOk(prevCasaRaw) ? prevCasaRaw : mediaGols(gfCasa, gsFora, baseLado * 1.1);
  let lambdaFora = golPrevOk(prevForaRaw) ? prevForaRaw : mediaGols(gfFora, gsCasa, baseLado * 0.9);

  if (!Number.isFinite(lambdaCasa) && !Number.isFinite(lambdaFora)) return null;
  lambdaCasa = clamp(Number.isFinite(lambdaCasa) ? lambdaCasa : 1.2, 0.15, 4.5);
  lambdaFora = clamp(Number.isFinite(lambdaFora) ? lambdaFora : 1.0, 0.15, 4.5);

  // Desfalques (lesões/suspensões): cada ausência reduz o ataque, até ~28%.
  const nLesCasa = Array.isArray(est.lesoesCasa) ? est.lesoesCasa.length : 0;
  const nLesFora = Array.isArray(est.lesoesFora) ? est.lesoesFora.length : 0;
  const penalDesfalque = (n: number) => clamp(1 - 0.035 * n, 0.72, 1);
  lambdaCasa *= penalDesfalque(nLesCasa);
  lambdaFora *= penalDesfalque(nLesFora);

  const fp = formaPonderada(est.formaCasa);
  const fpf = formaPonderada(est.formaFora);

  // Força relativa simples: ataque próprio + fragilidade defensiva do rival,
  // com leve ajuste de forma recente. Isso melhora o Poisson sem inventar dados.
  const formaCasaAdj = fp ? (fp.taxa - 0.5) * 0.18 : 0;
  const formaForaAdj = fpf ? (fpf.taxa - 0.5) * 0.18 : 0;
  lambdaCasa = clamp(lambdaCasa * (1 + formaCasaAdj), 0.15, 4.5);
  lambdaFora = clamp(lambdaFora * (1 + formaForaAdj), 0.15, 4.5);

  const lambdaTotal = lambdaCasa + lambdaFora;

  // 1X2: usa as probabilidades da API quando existirem; senão Poisson conjunto.
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

  // ----- Escanteios (item 10): base do campeonato + volume ofensivo relativo.
  // Times mais ofensivos que a média da liga tendem a forçar mais escanteios.
  const proporcaoOfensiva = clamp(lambdaTotal / cal.gols, 0.7, 1.4);
  const lambdaEscanteios = clamp(cal.escanteios * proporcaoOfensiva, 7, 13.5);

  // ----- Cartões (item 11): média dos times / confronto, ajustada por árbitro,
  // intensidade da liga e importância do jogo.
  const cConf = num(est.cartoesConfronto);
  const cCasa = num(est.cartoesCasa);
  const cFora = num(est.cartoesFora);
  let baseCartoes = Number.isFinite(cConf) ? cConf : NaN;
  if (!Number.isFinite(baseCartoes)) {
    if (Number.isFinite(cCasa) && Number.isFinite(cFora)) baseCartoes = cCasa + cFora;
    else if (Number.isFinite(cCasa)) baseCartoes = cCasa * 2;
    else if (Number.isFinite(cFora)) baseCartoes = cFora * 2;
    else baseCartoes = cal.cartoes;
  }
  const temArbitro = !!partida.arbitro && !!String(partida.arbitro).trim();
  const fatorArbitro = temArbitro ? 1.05 : 1; // árbitro escalado: leve alta
  const lambdaCartoes = clamp(baseCartoes * cal.intensidade * importancia.peso * fatorArbitro, 2, 9);

  const dadosDisponiveis = [gfCasa, gsCasa, gfFora, gsFora].filter((v) => Number.isFinite(v)).length;
  const qualidadeDados = clamp(
    35 + dadosDisponiveis * 9 + (fp ? 8 : 0) + (fpf ? 8 : 0) + (est.percent?.casa ? 8 : 0) + (est.escalacaoConfirmada ? 6 : 0) - (nLesCasa + nLesFora > 8 ? 8 : 0),
    25,
    96,
  );
  const variacaoGols = desvioRelativo([gfCasa, gsCasa, gfFora, gsFora]);
  const forcaCasa = clamp((lambdaCasa / Math.max(0.2, lambdaTotal)) * 2, 0.25, 1.75);
  const forcaFora = clamp((lambdaFora / Math.max(0.2, lambdaTotal)) * 2, 0.25, 1.75);

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
    formaCasa: fp ? fp.taxa : null,
    formaFora: fpf ? fpf.taxa : null,
    nLesCasa,
    nLesFora,
    cal,
    importancia,
    escalacaoConfirmada: !!est.escalacaoConfirmada,
    atkCasa: gfCasa,
    atkFora: gfFora,
    defCasa: gsCasa,
    defFora: gsFora,
    forcaCasa,
    forcaFora,
    qualidadeDados,
    variacaoGols,
  };
}

// Lado que a seleção favorece: "casa", "fora" ou null (mercado neutro).
function ladoDaSelecao(s: string, kCasa: string, kFora: string): "casa" | "fora" | null {
  if (kCasa && s.includes(kCasa)) return "casa";
  if (kFora && s.includes(kFora)) return "fora";
  return null;
}

// Devolve a probabilidade (0-1) do modelo para uma seleção específica.
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
  const tokens = s.split(" ").filter(Boolean);
  const temCasa = Boolean((kCasa && s.includes(kCasa)) || contemQualquer(s, ["casa", "mandante", "home"]) || tokens.includes("1"));
  const temFora = Boolean((kFora && s.includes(kFora)) || contemQualquer(s, ["fora", "visitante", "away"]) || tokens.includes("2"));
  const temEmpate = s.includes("empate") || tokens.includes("x") || s.includes("draw");
  const isOver = s.includes("mais de") || s.includes("over");
  const isUnder = s.includes("menos de") || s.includes("under");

  if (m.includes("resultado") || m.includes("vencedor") || m.includes("winner") || m.includes("1x2") || m.includes("match")) {
    if (temEmpate) return ctx.pEmpate;
    if (temCasa) return ctx.pCasa;
    if (temFora) return ctx.pFora;
    return null;
  }
  if (m.includes("dupla chance")) {
    if (temCasa && temEmpate) return ctx.pCasa + ctx.pEmpate;
    if (temEmpate && temFora) return ctx.pEmpate + ctx.pFora;
    if (temCasa && temFora) return ctx.pCasa + ctx.pFora;
    return null;
  }
  if (m.includes("dnb") || m.includes("empate anula")) {
    const base = ctx.pCasa + ctx.pFora || 1;
    if (temCasa) return ctx.pCasa / base;
    if (temFora) return ctx.pFora / base;
    return null;
  }
  if (m.includes("ambas")) {
    if (s.includes("sim")) return ctx.bttsSim;
    if (s.includes("nao")) return 1 - ctx.bttsSim;
    return null;
  }
  if (m.includes("marca gol") || m.includes("marca")) {
    if (temCasa) return 1 - ctx.pCasa0;
    if (temFora) return 1 - ctx.pFora0;
    if (s.includes("sim")) return ctx.bttsSim;
    if (s.includes("nao")) return 1 - ctx.bttsSim;
    return null;
  }
  if (m.includes("1") && m.includes("tempo")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver && linhaRelevante(true, linha, ctx.lambda1t)) return probOver(ctx.lambda1t, linha);
    if (isUnder && linhaRelevante(false, linha, ctx.lambda1t)) return probUnder(ctx.lambda1t, linha);
    return null;
  }
  if (m.includes("total de gols") || (m.includes("gols") && (isOver || isUnder))) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver && linhaRelevante(true, linha, ctx.lambdaTotal)) return probOver(ctx.lambdaTotal, linha);
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaTotal)) return probUnder(ctx.lambdaTotal, linha);
    return null;
  }
  if (m.includes("escanteio")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver && linhaRelevante(true, linha, ctx.lambdaEscanteios)) return probOver(ctx.lambdaEscanteios, linha);
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaEscanteios)) return probUnder(ctx.lambdaEscanteios, linha);
    return null;
  }
  if (m.includes("cart")) {
    const linha = extrairLinha(selecao);
    if (linha == null) return null;
    if (isOver && linhaRelevante(true, linha, ctx.lambdaCartoes)) return probOver(ctx.lambdaCartoes, linha);
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaCartoes)) return probUnder(ctx.lambdaCartoes, linha);
    return null;
  }
  return null;
}

// ---------- Calibração contra o mercado ----------
// O mercado de odds agrega muita informação externa. Para evitar excesso de
// confiança do Poisson em jogos com poucos dados, fazemos uma mistura conservadora
// entre probabilidade do modelo e probabilidade implícita das odds.
function probImplicitaNormalizada(oddsMercado: Array<{ selecao: string; valor: number }>, selecao: string): number | null {
  const validas = oddsMercado.filter((o) => Number.isFinite(o.valor) && o.valor > 1.01 && o.valor < 50);
  if (validas.length < 2 || validas.length > 4) return null;
  const soma = validas.reduce((acc, o) => acc + 1 / o.valor, 0);
  if (soma < 0.95 || soma > 1.45) return null;
  const key = normKey(selecao);
  const row = validas.find((o) => normKey(o.selecao) === key);
  if (!row) return null;
  return clamp((1 / row.valor) / soma, 0.02, 0.96);
}

function calibrarComMercado(probModelo: number, probMercado: number | null, ctx: Contexto, mercado: string): number {
  if (probMercado == null) return probModelo;
  const m = normKey(mercado);
  const mercadoEficiente = /resultado|vencedor|winner|1x2|dupla chance|dnb|empate anula|ambas/.test(m);
  const pesoMercadoBase = mercadoEficiente ? 0.28 : 0.12;
  const pesoDados = clamp(ctx.qualidadeDados / 100, 0.25, 0.96);
  const pesoMercado = clamp(pesoMercadoBase * (1 - pesoDados * 0.45), 0.06, pesoMercadoBase);
  return clamp(probModelo * (1 - pesoMercado) + probMercado * pesoMercado, 0.01, 0.97);
}

function riscoMercado(mercado: string, selecao: string, odd: number): number {
  const m = normKey(mercado);
  const s = normKey(selecao);
  let risco = 0;
  if (odd >= 3) risco += 4;
  else if (odd >= 2.35) risco += 2;
  if (/cart/.test(m)) risco += 2;
  if (/escanteio/.test(m)) risco += 1.5;
  if (/resultado|vencedor|winner|1x2/.test(m) && !/dupla|dnb|empate anula/.test(m)) risco += 1;
  if (s.includes("menos de") || s.includes("under")) risco += 0.5;
  return risco;
}

function scoreConfianca(args: {
  prob: number; ev: number; odd: number; lado: "casa" | "fora" | null; ctx: Contexto; mercado: string; selecao: string;
}) {
  const { prob, ev, odd, lado, ctx, mercado, selecao } = args;
  let score = prob * 100;

  // Value real melhora score, mas sem exagerar. EV negativo derruba forte.
  if (ev > 0) score += clamp(ev * 65, 0, 8);
  else score += clamp(ev * 90, -12, 0);

  const forma = lado === "casa" ? ctx.formaCasa : lado === "fora" ? ctx.formaFora : null;
  if (forma != null) score += clamp((forma - 0.5) * 12, -5, 5);

  if (lado === "casa") {
    score += clamp((ctx.forcaCasa - 1) * 5, -4, 4);
    if (ctx.nLesFora >= 2) score += 1.5;
    if (ctx.nLesCasa >= 3) score -= 3;
  } else if (lado === "fora") {
    score += clamp((ctx.forcaFora - 1) * 5, -4, 4);
    if (ctx.nLesCasa >= 2) score += 1.5;
    if (ctx.nLesFora >= 3) score -= 3;
  }

  score += (ctx.qualidadeDados - 60) * 0.08;
  if (ctx.escalacaoConfirmada) score += 1.5;
  if (ctx.variacaoGols > 0.55) score -= 2; // jogo instável
  if (odd < 1.22) score -= 3;
  if (odd >= 1.55 && odd <= 2.25) score += 1.2;
  score -= riscoMercado(mercado, selecao, odd);

  return clamp(Math.round(score), 1, 96);
}

// ---------- Value Bet (item 2) ----------
function classificarValor(ev: number): ValorLabel {
  if (ev >= 0.08) return "Excelente Valor";
  if (ev >= 0.04) return "Bom Valor";
  if (ev >= 0.005) return "Valor Moderado";
  return "Sem Valor";
}

// ---------- Classificação por estrelas (item 14) ----------
function estrelasDaPick(confianca: number, ev: number): number {
  if (confianca >= 85 && ev >= 0.06) return 5;
  if (confianca >= 75 && ev >= 0.03) return 4;
  if (confianca >= 65 && ev >= 0.01) return 3;
  if (confianca >= 55) return 2;
  return 1;
}

// ---------- Filtros inteligentes (item 15) ----------
const LAMBDA_PADRAO: Array<{ re: RegExp; lambda: number }> = [
  { re: /escanteio/, lambda: 9.8 },
  { re: /cart/, lambda: 4.4 },
  { re: /(1|primeiro).*tempo|tempo.*(1|primeiro)/, lambda: 1.1 },
  { re: /gol/, lambda: 2.6 },
];
function linhaSensata(mercado: string, selecao: string): boolean {
  const s = normKey(selecao);
  const isOver = s.includes("mais de");
  const isUnder = s.includes("menos de");
  if (!isOver && !isUnder) return true;
  const linha = extrairLinha(selecao);
  if (linha == null) return true;
  const m = normKey(mercado);
  const found = LAMBDA_PADRAO.find((x) => x.re.test(m) || x.re.test(s));
  if (!found) return true;
  return linhaRelevante(isOver, linha, found.lambda);
}

// Traduz seleções em inglês para PT (evita duplicados "Under" vs "Menos de").
function traduzPt(selecao: string) {
  return String(selecao ?? "")
    .replace(/\bOver\s*([0-9.]+)?/gi, (_m, n) => `Mais de${n ? ` ${n}` : ""}`)
    .replace(/\bUnder\s*([0-9.]+)?/gi, (_m, n) => `Menos de${n ? ` ${n}` : ""}`)
    .replace(/\bHome\b/gi, "Casa")
    .replace(/\bAway\b/gi, "Fora")
    .replace(/\bDraw\b/gi, "Empate")
    .replace(/\bYes\b/gi, "Sim")
    .replace(/\bNo\b/gi, "Não")
    .replace(/\s+/g, " ")
    .trim();
}

function confiancaPorOddSegura(odd: number) {
  if (odd <= 1.35) return 94;
  if (odd <= 1.6) return 92;
  if (odd <= 1.9) return 90;
  if (odd <= 2.3) return 84;
  return 78;
}

// Fallback sem estatísticas: usa as próprias odds (favoritos = mais chance).
// Sem estatísticas não há como calcular valor esperado real, então mantemos o
// comportamento anterior (favoritos seguros) para não quebrar o fluxo do app.
function picksSoOdds(partida: PartidaRow, casa: string): PickAnalise[] {
  const vistos = new Set<string>();
  const picks: PickAnalise[] = [];
  for (const o of partida.odds
    .filter((o) => normKey(o.casa) === normKey(casa) && o.valor >= 1.2 && o.valor <= 4.5)
    .filter((o) => linhaSensata(o.mercado || "", o.selecao))
    .sort((a, b) => a.valor - b.valor)) {
    const mercado = o.mercado || "Resultado Final";
    const selecao = traduzPt(o.selecao);
    const chave = `${normKey(mercado)}|${normKey(selecao)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const conf = confiancaPorOddSegura(o.valor);
    const implicita = Math.round((1 / o.valor) * 100);
    picks.push({
      mercado,
      selecao,
      odd: o.valor,
      confianca: conf,
      probModelo: conf,
      oddJusta: Number((100 / conf).toFixed(2)),
      evPct: 0,
      valorLabel: "Valor Moderado",
      estrelas: o.valor <= 1.5 ? 3 : 2,
      motivos: [`Favorito pelas odds (chance implícita ${implicita}%)`, "Estatísticas detalhadas indisponíveis para este jogo"],
      justificativa: `Análise local pelas odds: favorito com odd ${o.valor.toFixed(2)} (chance implícita ${implicita}%).`,
      external_odd_id: o.external_odd_id,
    });
    if (picks.length >= 5) break;
  }
  return picks;
}

// Gera as justificativas automáticas (item 13) a partir dos fatores reais.
function montarMotivos(args: {
  ctx: Contexto;
  prob: number;
  ev: number;
  odd: number;
  lado: "casa" | "fora" | null;
  casa: string;
  fora: string;
  mercado: string;
}): string[] {
  const { ctx, prob, ev, odd, lado, casa, fora, mercado } = args;
  const motivos: string[] = [];
  const m = normKey(mercado);

  motivos.push(`Modelo Poisson indica ${Math.round(prob * 100)}% de chance (odd ${odd.toFixed(2)})`);

  if (ev > 0) motivos.push(`Valor esperado positivo (+${Math.round(ev * 100)}%) sobre a odd da casa`);

  // Forma recente ponderada.
  if (lado === "casa" && ctx.formaCasa != null && ctx.formaCasa >= 0.55)
    motivos.push(`${casa} em boa fase (aproveitamento recente ${Math.round(ctx.formaCasa * 100)}%)`);
  if (lado === "fora" && ctx.formaFora != null && ctx.formaFora >= 0.55)
    motivos.push(`${fora} em boa fase (aproveitamento recente ${Math.round(ctx.formaFora * 100)}%)`);

  // Gols esperados / tendência.
  if (/gol|ambas|marca/.test(m))
    motivos.push(`Média conjunta esperada de ${ctx.lambdaTotal.toFixed(1)} gols (${casa} ${ctx.lambdaCasa.toFixed(1)} / ${fora} ${ctx.lambdaFora.toFixed(1)})`);
  if (/escanteio/.test(m)) motivos.push(`Escanteios esperados ~${ctx.lambdaEscanteios.toFixed(1)} no jogo`);
  if (/cart/.test(m)) motivos.push(`Cartões esperados ~${ctx.lambdaCartoes.toFixed(1)} (liga + árbitro + importância)`);

  // Desfalques do adversário favorecem o lado.
  if (lado === "casa" && ctx.nLesFora >= 2) motivos.push(`${fora} com ${ctx.nLesFora} desfalques`);
  if (lado === "fora" && ctx.nLesCasa >= 2) motivos.push(`${casa} com ${ctx.nLesCasa} desfalques`);

  if (ctx.escalacaoConfirmada) motivos.push("Escalação já confirmada");
  if (ctx.importancia.rotulo) motivos.push(ctx.importancia.rotulo);

  return motivos.slice(0, 6);
}

/**
 * Análise 100% local de UM jogo. Poisson + fatores ponderados + value bet.
 */
export function analisarLocal(partida: PartidaRow, casa: string): AnalisePartida {
  const analise: AnaliseJogoStats = analiseDeEstatisticas(partida);
  const oddsCasa = partida.odds.filter((o) => normKey(o.casa) === normKey(casa));

  const ctx = montarContexto(partida);
  if (!ctx) {
    return { picks: picksSoOdds(partida, casa), analise };
  }

  const kCasa = normKey(partida.time_casa);
  const kFora = normKey(partida.time_fora);

  type Cand = PickAnalise & { prob: number; ev: number };
  const porMercado = new Map<string, Cand>();

  for (const o of oddsCasa) {
    if (!Number.isFinite(o.valor) || o.valor < 1.15 || o.valor > 8) continue;
    if (!linhaSensata(o.mercado || "", o.selecao)) continue;
    const prob = probDaSelecao(o.mercado, o.selecao, ctx, partida.time_casa, partida.time_fora);
    if (prob == null || !Number.isFinite(prob) || prob <= 0) continue;

    const s = normKey(o.selecao);
    const lado = ladoDaSelecao(s, kCasa, kFora);

    // ----- SCORE DE CONFIANÇA COMPOSTO V2 -----
    const oddsMesmoMercado = oddsCasa.filter((x) => normKey(x.mercado || "") === normKey(o.mercado || ""));
    const probMercado = probImplicitaNormalizada(oddsMesmoMercado, o.selecao);
    const probCalibrada = calibrarComMercado(prob, probMercado, ctx, o.mercado || "");
    const ev = probCalibrada * o.valor - 1; // valor esperado por unidade apostada
    const confianca = scoreConfianca({ prob: probCalibrada, ev, odd: o.valor, lado, ctx, mercado: o.mercado || "", selecao: o.selecao });
    const oddJusta = Number((1 / probCalibrada).toFixed(2));
    const valorLabel = classificarValor(ev);
    const estrelas = estrelasDaPick(confianca, ev);
    const motivos = montarMotivos({ ctx, prob: probCalibrada, ev, odd: o.valor, lado, casa: partida.time_casa, fora: partida.time_fora, mercado: o.mercado || "" });

    const cand: Cand = {
      mercado: o.mercado || "Resultado Final",
      selecao: traduzPt(o.selecao),
      odd: o.valor,
      confianca,
      prob: probCalibrada,
      ev,
      probModelo: Math.round(probCalibrada * 100),
      oddJusta,
      evPct: Number((ev * 100).toFixed(1)),
      valorLabel,
      estrelas,
      motivos,
      justificativa: motivos.join(" • "),
      external_odd_id: o.external_odd_id,
    };

    // Mantém a melhor seleção por mercado (evita over + under do mesmo mercado).
    const chave = normKey(cand.mercado);
    const atual = porMercado.get(chave);
    if (!atual || cand.confianca + cand.ev * 80 > atual.confianca + atual.ev * 80) porMercado.set(chave, cand);
  }

  // ----- Filtros inteligentes (item 15) + regra de value bet (item 2) -----
  // Só recomenda picks com valor esperado positivo. Ordena por estrelas e
  // confiança (mais consistentes primeiro) e mantém as melhores.
  const comValor = [...porMercado.values()].filter((p) => p.ev > 0.003 && p.confianca >= 55);
  const escolhidas = comValor
    .sort((a, b) => (b.estrelas ?? 0) - (a.estrelas ?? 0) || b.confianca - a.confianca || b.ev - a.ev)
    .slice(0, 6)
    .map(({ prob, ev, ...p }) => p);

  if (!escolhidas.length) {
    // Nenhum +EV: mantém apenas favoritos seguros (não quebra o fluxo do app),
    // rotulados como sem valor de mercado, ordenados por probabilidade.
    const seguras = [...porMercado.values()]
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 3)
      .map(({ prob, ev, ...p }) => p);
    if (seguras.length) return { picks: seguras, analise };
    return { picks: picksSoOdds(partida, casa), analise };
  }
  return { picks: escolhidas, analise };
}
