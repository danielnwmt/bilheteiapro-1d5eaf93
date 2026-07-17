// Motor de Análise V3 — 100% LOCAL, determinístico e sem IA/LLM.
//
// Objetivo: aumentar consistência/assertividade usando um modelo híbrido:
// Poisson calibrado por liga + força relativa (Elo proxy) + forma recente + casa/fora
// + desfalques + escalação + value bet + qualidade de dados + filtros por mercado.
//
// Regras centrais:
// - Nunca inventa mercado, seleção ou odd: só analisa odds reais salvas.
// - IA/LLM não participa da decisão nem da explicação.
// - Cliente continua lendo analise_cache; robô pré-analisa e salva.
// - Quando os dados são fracos, o motor reduz confiança e evita picks agressivas.
import type {
  AnalisePartida,
  AnaliseJogoStats,
  PartidaRow,
  PickAnalise,
  ValorLabel,
  AnalysisQuality,
} from "./analise.server";
import { analiseDeEstatisticas, CALCULATION_VERSION } from "./analise.server";

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function normKey(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactKey(value: string | null | undefined) {
  return normKey(value).replace(/\s+/g, "");
}

function num(value: unknown, fallback = NaN): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function percent(n: number) {
  return `${Math.round(n * 100)}%`;
}

function pct(value: unknown): number | null {
  const n = num(value, NaN);
  if (!Number.isFinite(n)) return null;
  // API-Football costuma retornar 0-100; se vier 0-1, mantemos.
  return clamp(n > 1 ? n / 100 : n, 0, 1);
}

// ------------------------------------------------------------
// Distribuições: Poisson e matriz de placares
// ------------------------------------------------------------
function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCdf(lambda: number, k: number): number {
  let acc = 0;
  for (let i = 0; i <= k; i++) acc += poissonPmf(lambda, i);
  return clamp(acc, 0, 1);
}

function probOver(lambda: number, linha: number): number {
  return clamp(1 - poissonCdf(lambda, Math.floor(linha)), 0, 1);
}

function probUnder(lambda: number, linha: number): number {
  return clamp(poissonCdf(lambda, Math.floor(linha)), 0, 1);
}

function extrairLinha(texto: string): number | null {
  const m = String(texto ?? "").match(/([0-9]+(?:[.,][0-9]+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function linhaRelevante(isOver: boolean, linha: number, lambda: number, mercado: "gols" | "1t" | "escanteios" | "cartoes" | "chutes") {
  // Mantém linhas relevantes e corta armadilhas triviais/absurdas.
  const cfg = {
    gols: { minOver: 0.5, minUnder: 1.5, margem: 2.2 },
    "1t": { minOver: 0.5, minUnder: 0.5, margem: 1.7 },
    escanteios: { minOver: 6.5, minUnder: 6.5, margem: 3.2 },
    cartoes: { minOver: 2.5, minUnder: 2.5, margem: 2.6 },
    chutes: { minOver: 2.5, minUnder: 2.5, margem: 3.5 },
  }[mercado];
  if (isOver && linha < cfg.minOver) return false;
  if (!isOver && linha < cfg.minUnder) return false;
  return isOver ? linha >= lambda - cfg.margem : linha <= lambda + cfg.margem;
}

// ------------------------------------------------------------
// Calibração por campeonato
// ------------------------------------------------------------
interface LigaCal {
  gols: number;
  escanteios: number;
  cartoes: number;
  intensidade: number;
  mandante: number; // vantagem média do mandante na liga
}

const LIGA_PADRAO: LigaCal = { gols: 2.6, escanteios: 9.8, cartoes: 4.4, intensidade: 1, mandante: 1.06 };
const LIGA_CAL: Array<{ re: RegExp; cal: LigaCal }> = [
  { re: /brasileir.*(serie a|a$)/, cal: { gols: 2.5, escanteios: 9.6, cartoes: 5.1, intensidade: 1.08, mandante: 1.08 } },
  { re: /brasileir.*serie b/, cal: { gols: 2.3, escanteios: 9.2, cartoes: 5.3, intensidade: 1.1, mandante: 1.09 } },
  { re: /copa do brasil/, cal: { gols: 2.4, escanteios: 9.4, cartoes: 5.4, intensidade: 1.15, mandante: 1.06 } },
  { re: /libertadores/, cal: { gols: 2.5, escanteios: 9.8, cartoes: 5.6, intensidade: 1.18, mandante: 1.07 } },
  { re: /sul americana|sudamericana/, cal: { gols: 2.4, escanteios: 9.5, cartoes: 5.5, intensidade: 1.15, mandante: 1.07 } },
  { re: /premier league/, cal: { gols: 2.8, escanteios: 10.6, cartoes: 3.8, intensidade: 1, mandante: 1.05 } },
  { re: /la liga/, cal: { gols: 2.5, escanteios: 9.9, cartoes: 4.9, intensidade: 1.05, mandante: 1.05 } },
  { re: /serie a.*ital|serie a$/, cal: { gols: 2.7, escanteios: 10.1, cartoes: 4.6, intensidade: 1.03, mandante: 1.05 } },
  { re: /bundesliga/, cal: { gols: 3.1, escanteios: 10.2, cartoes: 3.6, intensidade: 1, mandante: 1.04 } },
  { re: /ligue 1/, cal: { gols: 2.6, escanteios: 9.9, cartoes: 4.2, intensidade: 1.02, mandante: 1.05 } },
  { re: /champions/, cal: { gols: 2.8, escanteios: 10.4, cartoes: 4.0, intensidade: 1.12, mandante: 1.03 } },
  { re: /europa league/, cal: { gols: 2.7, escanteios: 10.2, cartoes: 4.3, intensidade: 1.08, mandante: 1.03 } },
  { re: /conference/, cal: { gols: 2.8, escanteios: 10.0, cartoes: 4.2, intensidade: 1.06, mandante: 1.03 } },
  { re: /copa do mundo|world cup/, cal: { gols: 2.6, escanteios: 9.8, cartoes: 4.4, intensidade: 1.2, mandante: 1.01 } },
];

function calibracaoLiga(liga: string | null): LigaCal {
  const k = normKey(liga);
  return LIGA_CAL.find((x) => x.re.test(k))?.cal ?? LIGA_PADRAO;
}

function importanciaJogo(liga: string | null): { peso: number; rotulo: string | null } {
  const k = normKey(liga);
  if (/copa do mundo|world cup/.test(k)) return { peso: 1.2, rotulo: "Jogo de Copa do Mundo / alta importância" };
  if (/libertadores|champions/.test(k)) return { peso: 1.15, rotulo: "Competição continental de alta pressão" };
  if (/copa do brasil|sul americana|sudamericana|europa league|conference/.test(k)) return { peso: 1.1, rotulo: "Copa ou mata-mata: contexto aumenta intensidade" };
  return { peso: 1, rotulo: null };
}

// ------------------------------------------------------------
// Forma recente e força relativa
// ------------------------------------------------------------
function formaPonderada(forma: string | null | undefined): { taxa: number; jogos: number } | null {
  const chars = String(forma ?? "").toUpperCase().replace(/[^WDL]/g, "").split("");
  if (!chars.length) return null;
  const recentes = chars.slice(-10);
  let somaPeso = 0;
  let somaPts = 0;
  const n = recentes.length;
  for (let i = 0; i < n; i++) {
    const desdeFim = n - 1 - i;
    const peso = desdeFim < 3 ? 1.0 : desdeFim < 6 ? 0.7 : 0.4;
    const pts = recentes[i] === "W" ? 1 : recentes[i] === "D" ? 0.5 : 0;
    somaPeso += peso;
    somaPts += pts * peso;
  }
  return somaPeso > 0 ? { taxa: clamp(somaPts / somaPeso, 0, 1), jogos: n } : null;
}

function mediaNumerica(...values: number[]) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return NaN;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Proxy de Elo sem tabela histórica: usa força ofensiva/defensiva, forma e probabilidades da API.
// Não é um Elo real persistido, mas funciona como ajuste de força relativa determinístico.
function eloProxy(args: {
  gf: number;
  gsAdversario: number;
  forma: number | null;
  pApi: number | null;
  baseLado: number;
}) {
  const ataque = Number.isFinite(args.gf) ? (args.gf - args.baseLado) * 55 : 0;
  const fragDefAdv = Number.isFinite(args.gsAdversario) ? (args.gsAdversario - args.baseLado) * 45 : 0;
  const forma = args.forma != null ? (args.forma - 0.5) * 120 : 0;
  const api = args.pApi != null ? (args.pApi - 0.333) * 90 : 0;
  return 1500 + ataque + fragDefAdv + forma + api;
}

// ------------------------------------------------------------
// Contexto do jogo
// ------------------------------------------------------------
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
  lambdaChutes: number;
  formaCasa: number | null;
  formaFora: number | null;
  nLesCasa: number;
  nLesFora: number;
  cal: LigaCal;
  importancia: { peso: number; rotulo: string | null };
  escalacaoConfirmada: boolean;
  qualidadeDados: number; // 0-1
  atkCasa: number;
  atkFora: number;
  defCasa: number;
  defFora: number;
  eloCasa: number;
  eloFora: number;
}

function montarContexto(partida: PartidaRow): Contexto | null {
  const est = partida.estatisticas;
  if (!est) return null;

  const cal = calibracaoLiga(partida.liga);
  const importancia = importanciaJogo(partida.liga);

  const gfCasa = num(est.golsFeitosCasa);
  const gsCasa = num(est.golsSofridosCasa);
  const gfFora = num(est.golsFeitosFora);
  const gsFora = num(est.golsSofridosFora);
  const baseLado = cal.gols / 2;

  const prevCasaRaw = num(est.golsPrev?.casa);
  const prevForaRaw = num(est.golsPrev?.fora);
  const golPrevOk = (n: number) => Number.isFinite(n) && n >= 0.2 && n <= 5;

  const fp = formaPonderada(est.formaCasa);
  const ff = formaPonderada(est.formaFora);
  const formaCasa = fp?.taxa ?? null;
  const formaFora = ff?.taxa ?? null;

  const pApiCasa = pct(est.percent?.casa);
  const pApiEmpate = pct(est.percent?.empate);
  const pApiFora = pct(est.percent?.fora);

  // Lambda base com separação casa/fora: ataque do time x defesa adversária.
  const lambdaBaseCasa = golPrevOk(prevCasaRaw)
    ? prevCasaRaw
    : mediaNumerica(Number.isFinite(gfCasa) ? gfCasa : NaN, Number.isFinite(gsFora) ? gsFora : NaN, baseLado * cal.mandante);
  const lambdaBaseFora = golPrevOk(prevForaRaw)
    ? prevForaRaw
    : mediaNumerica(Number.isFinite(gfFora) ? gfFora : NaN, Number.isFinite(gsCasa) ? gsCasa : NaN, baseLado / cal.mandante);

  let lambdaCasa = Number.isFinite(lambdaBaseCasa) ? lambdaBaseCasa : baseLado * cal.mandante;
  let lambdaFora = Number.isFinite(lambdaBaseFora) ? lambdaBaseFora : baseLado / cal.mandante;

  // Regressão para a média da liga: evita overfit quando estatística é fraca.
  const dadosGols = [gfCasa, gsCasa, gfFora, gsFora].filter((n) => Number.isFinite(n)).length;
  const regressao = dadosGols >= 4 ? 0.18 : dadosGols >= 2 ? 0.32 : 0.48;
  lambdaCasa = lambdaCasa * (1 - regressao) + baseLado * cal.mandante * regressao;
  lambdaFora = lambdaFora * (1 - regressao) + (baseLado / cal.mandante) * regressao;

  // Ajuste por forma recente, limitado para não exagerar.
  if (formaCasa != null) lambdaCasa *= clamp(0.92 + formaCasa * 0.16, 0.9, 1.08);
  if (formaFora != null) lambdaFora *= clamp(0.92 + formaFora * 0.16, 0.9, 1.08);

  // Desfalques: reduz produção ofensiva e aumenta incerteza.
  const nLesCasa = Array.isArray(est.lesoesCasa) ? est.lesoesCasa.length : 0;
  const nLesFora = Array.isArray(est.lesoesFora) ? est.lesoesFora.length : 0;
  lambdaCasa *= clamp(1 - 0.032 * nLesCasa, 0.72, 1);
  lambdaFora *= clamp(1 - 0.032 * nLesFora, 0.72, 1);

  lambdaCasa = clamp(lambdaCasa, 0.15, 4.3);
  lambdaFora = clamp(lambdaFora, 0.15, 4.3);

  // Probabilidades 1X2 por Poisson conjunto com leve ajuste Dixon-Coles simples:
  // aumenta empates 0x0/1x1 em jogos de lambda baixo, reduz overconfidence.
  let ph = 0;
  let pd = 0;
  let pa = 0;
  const maxGoals = 10;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      let p = poissonPmf(lambdaCasa, i) * poissonPmf(lambdaFora, j);
      if (i === j && i <= 1 && lambdaCasa + lambdaFora < 2.7) p *= 1.06;
      if (i > j) ph += p;
      else if (i === j) pd += p;
      else pa += p;
    }
  }
  const somaPoi = ph + pd + pa || 1;
  ph /= somaPoi; pd /= somaPoi; pa /= somaPoi;

  // Mistura com probabilidade da API, quando existe. Isso reduz viés do Poisson isolado.
  let pCasa = ph;
  let pEmpate = pd;
  let pFora = pa;
  if (pApiCasa != null && pApiEmpate != null && pApiFora != null) {
    const somaApi = pApiCasa + pApiEmpate + pApiFora || 1;
    const aCasa = pApiCasa / somaApi;
    const aEmp = pApiEmpate / somaApi;
    const aFora = pApiFora / somaApi;
    pCasa = ph * 0.62 + aCasa * 0.38;
    pEmpate = pd * 0.62 + aEmp * 0.38;
    pFora = pa * 0.62 + aFora * 0.38;
  }

  // Elo proxy corrige levemente as probabilidades de resultado.
  const eloCasa = eloProxy({ gf: gfCasa, gsAdversario: gsFora, forma: formaCasa, pApi: pApiCasa, baseLado });
  const eloFora = eloProxy({ gf: gfFora, gsAdversario: gsCasa, forma: formaFora, pApi: pApiFora, baseLado });
  const diffElo = clamp((eloCasa - eloFora) / 400, -0.35, 0.35);
  pCasa *= 1 + diffElo * 0.12;
  pFora *= 1 - diffElo * 0.12;
  const soma = pCasa + pEmpate + pFora || 1;
  pCasa /= soma; pEmpate /= soma; pFora /= soma;

  const pCasa0 = poissonPmf(lambdaCasa, 0);
  const pFora0 = poissonPmf(lambdaFora, 0);
  const bttsSim = clamp((1 - pCasa0) * (1 - pFora0), 0, 1);
  const lambdaTotal = lambdaCasa + lambdaFora;

  // Escanteios: liga + volume ofensivo + equilíbrio do jogo.
  const equilibrio = 1 - Math.abs(pCasa - pFora); // jogo equilibrado tende a manter volume dos dois lados
  const volumeOfensivo = clamp(lambdaTotal / cal.gols, 0.72, 1.34);
  const formaVolume = 1 + (((formaCasa ?? 0.5) + (formaFora ?? 0.5)) / 2 - 0.5) * 0.12;
  const lambdaEscanteios = clamp(cal.escanteios * volumeOfensivo * (0.94 + equilibrio * 0.08) * formaVolume, 6.8, 13.8);

  // Cartões: média da liga/time + intensidade + equilíbrio + importância + árbitro escalado.
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
  const fatorArbitro = temArbitro ? 1.04 : 0.98;
  const fatorEquilibrioCartoes = 0.92 + equilibrio * 0.14;
  const lambdaCartoes = clamp(baseCartoes * cal.intensidade * importancia.peso * fatorArbitro * fatorEquilibrioCartoes, 2.1, 9.2);

  // Chutes ao gol (total no jogo): correlaciona com volume ofensivo.
  // Aproximação: ~3.6 chutes ao gol por gol esperado, com piso/teto realistas.
  const lambdaChutes = clamp(lambdaTotal * 3.6 * (0.94 + equilibrio * 0.08) * formaVolume, 5.5, 14.5);

  let qualidadeDados = 0.35;
  if (dadosGols >= 4) qualidadeDados += 0.22;
  else if (dadosGols >= 2) qualidadeDados += 0.12;
  if (fp && fp.jogos >= 5) qualidadeDados += 0.12;
  if (ff && ff.jogos >= 5) qualidadeDados += 0.12;
  if (pApiCasa != null && pApiEmpate != null && pApiFora != null) qualidadeDados += 0.16;
  if (est.escalacaoConfirmada) qualidadeDados += 0.08;
  if (Number.isFinite(cCasa) || Number.isFinite(cFora) || Number.isFinite(cConf)) qualidadeDados += 0.05;
  qualidadeDados = clamp(qualidadeDados, 0.25, 0.98);

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
    lambda1t: clamp(lambdaTotal * 0.44, 0.2, 3.0),
    lambdaEscanteios,
    lambdaCartoes,
    lambdaChutes,
    formaCasa,
    formaFora,
    nLesCasa,
    nLesFora,
    cal,
    importancia,
    escalacaoConfirmada: !!est.escalacaoConfirmada,
    qualidadeDados,
    atkCasa: gfCasa,
    atkFora: gfFora,
    defCasa: gsCasa,
    defFora: gsFora,
    eloCasa,
    eloFora,
  };
}

// ------------------------------------------------------------
// Interpretação de mercado/seleção
// ------------------------------------------------------------
type MercadoTipo = "resultado" | "dupla" | "dnb" | "btts" | "time_gol" | "gols" | "gols_1t" | "escanteios" | "cartoes" | "chutes" | "handicap" | "placar" | "desconhecido";

function tipoMercado(mercado: string, selecao: string): MercadoTipo {
  const m = normKey(mercado);
  const s = normKey(selecao);
  if (m.includes("dupla chance") || m.includes("double chance")) return "dupla";
  if (m.includes("dnb") || m.includes("empate anula") || m.includes("draw no bet")) return "dnb";
  if (m.includes("ambas") || m.includes("both teams") || m.includes("btts")) return "btts";
  if (m.includes("marca gol") || m.includes("team to score") || m.includes("time marca")) return "time_gol";
  if (m.includes("escanteio") || m.includes("corner")) return "escanteios";
  if (m.includes("cart") || m.includes("card")) return "cartoes";
  if (m.includes("chute") || m.includes("shot")) return "chutes";
  if (m.includes("placar exato") || m.includes("correct score") || m.includes("resultado exato")) return "placar";
  if (m.includes("handicap") || m.includes("asian") || m.includes("asiatico")) return "handicap";
  if ((m.includes("1") && m.includes("tempo")) || m.includes("1st half") || m.includes("first half")) return "gols_1t";
  if (m.includes("total de gols") || m.includes("over under") || (m.includes("gols") && (s.includes("mais de") || s.includes("menos de") || s.includes("over") || s.includes("under")))) return "gols";
  if (m.includes("resultado") || m.includes("match winner") || m.includes("winner") || m.includes("1x2")) return "resultado";
  return "desconhecido";
}

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

function selecaoTemCasa(s: string, casa: string) {
  const cs = compactKey(casa);
  const ss = compactKey(s);
  return (cs && ss.includes(cs)) || /^1$/.test(ss) || /\bcasa\b|\bhome\b/.test(normKey(s));
}

function selecaoTemFora(s: string, fora: string) {
  const fs = compactKey(fora);
  const ss = compactKey(s);
  return (fs && ss.includes(fs)) || /^2$/.test(ss) || /\bfora\b|\baway\b/.test(normKey(s));
}

function selecaoTemEmpate(s: string) {
  const k = normKey(s);
  return /\bempate\b|\bdraw\b|^x$/.test(k);
}

function ladoDaSelecao(selecao: string, casa: string, fora: string): "casa" | "fora" | null {
  if (selecaoTemCasa(selecao, casa)) return "casa";
  if (selecaoTemFora(selecao, fora)) return "fora";
  return null;
}

function probDaSelecao(mercado: string, selecao: string, ctx: Contexto, casa: string, fora: string): { prob: number; tipo: MercadoTipo } | null {
  const tipo = tipoMercado(mercado, selecao);
  const s = normKey(selecao);
  const temCasa = selecaoTemCasa(selecao, casa);
  const temFora = selecaoTemFora(selecao, fora);
  const temEmpate = selecaoTemEmpate(selecao);
  const isOver = s.includes("mais de") || s.includes("over");
  const isUnder = s.includes("menos de") || s.includes("under");

  if (tipo === "resultado") {
    if (temEmpate) return { prob: ctx.pEmpate, tipo };
    if (temCasa) return { prob: ctx.pCasa, tipo };
    if (temFora) return { prob: ctx.pFora, tipo };
    return null;
  }
  if (tipo === "dupla") {
    if (temCasa && temEmpate) return { prob: ctx.pCasa + ctx.pEmpate, tipo };
    if (temEmpate && temFora) return { prob: ctx.pEmpate + ctx.pFora, tipo };
    if (temCasa && temFora) return { prob: ctx.pCasa + ctx.pFora, tipo };
    return null;
  }
  if (tipo === "dnb") {
    const base = ctx.pCasa + ctx.pFora || 1;
    if (temCasa) return { prob: ctx.pCasa / base, tipo };
    if (temFora) return { prob: ctx.pFora / base, tipo };
    return null;
  }
  if (tipo === "btts") {
    if (s.includes("sim") || s.includes("yes")) return { prob: ctx.bttsSim, tipo };
    if (s.includes("nao") || s.includes("no")) return { prob: 1 - ctx.bttsSim, tipo };
    return null;
  }
  if (tipo === "time_gol") {
    if (temCasa) return { prob: 1 - ctx.pCasa0, tipo };
    if (temFora) return { prob: 1 - ctx.pFora0, tipo };
    if (s.includes("sim") || s.includes("yes")) return { prob: ctx.bttsSim, tipo };
    if (s.includes("nao") || s.includes("no")) return { prob: 1 - ctx.bttsSim, tipo };
    return null;
  }

  const linha = extrairLinha(selecao);
  if (linha == null) return null;

  if (tipo === "gols_1t") {
    if (isOver && linhaRelevante(true, linha, ctx.lambda1t, "1t")) return { prob: probOver(ctx.lambda1t, linha), tipo };
    if (isUnder && linhaRelevante(false, linha, ctx.lambda1t, "1t")) return { prob: probUnder(ctx.lambda1t, linha), tipo };
    return null;
  }
  if (tipo === "gols") {
    if (isOver && linhaRelevante(true, linha, ctx.lambdaTotal, "gols")) return { prob: probOver(ctx.lambdaTotal, linha), tipo };
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaTotal, "gols")) return { prob: probUnder(ctx.lambdaTotal, linha), tipo };
    return null;
  }
  if (tipo === "escanteios") {
    if (isOver && linhaRelevante(true, linha, ctx.lambdaEscanteios, "escanteios")) return { prob: probOver(ctx.lambdaEscanteios, linha), tipo };
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaEscanteios, "escanteios")) return { prob: probUnder(ctx.lambdaEscanteios, linha), tipo };
    return null;
  }
  if (tipo === "cartoes") {
    if (isOver && linhaRelevante(true, linha, ctx.lambdaCartoes, "cartoes")) return { prob: probOver(ctx.lambdaCartoes, linha), tipo };
    if (isUnder && linhaRelevante(false, linha, ctx.lambdaCartoes, "cartoes")) return { prob: probUnder(ctx.lambdaCartoes, linha), tipo };
    return null;
  }
  if (tipo === "chutes") {
    // Se seleção menciona um dos times, usa metade do lambda; caso contrário total.
    let lam = ctx.lambdaChutes;
    if (temCasa && !temFora) lam = ctx.lambdaChutes * (ctx.lambdaCasa / Math.max(0.01, ctx.lambdaTotal));
    else if (temFora && !temCasa) lam = ctx.lambdaChutes * (ctx.lambdaFora / Math.max(0.01, ctx.lambdaTotal));
    if (isOver && linhaRelevante(true, linha, lam, "chutes")) return { prob: probOver(lam, linha), tipo };
    if (isUnder && linhaRelevante(false, linha, lam, "chutes")) return { prob: probUnder(lam, linha), tipo };
    return null;
  }
  if (tipo === "handicap") {
    // Suporta apenas linhas de meio ponto (sem push) para evitar aproximações de ½ vitória.
    const hMatch = String(selecao).match(/([+-]?\s*\d+(?:[.,]\d+)?)/);
    if (!hMatch) return null;
    const handicap = Number(hMatch[1].replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(handicap)) return null;
    // Só linhas .5 (evita push do handicap inteiro/quarto).
    if (Math.abs(handicap * 2 - Math.round(handicap * 2)) > 0.01) return null;
    if (Math.abs(handicap - Math.round(handicap)) < 0.01) return null;
    const lado: "casa" | "fora" | null = temCasa ? "casa" : temFora ? "fora" : null;
    if (!lado) return null;
    // Prob(diferença casa - fora > -handicap) para lado casa; simétrico para fora.
    const p = probHandicap(ctx.lambdaCasa, ctx.lambdaFora, lado, handicap);
    return { prob: p, tipo };
  }
  if (tipo === "placar") {
    const pm = String(selecao).match(/(\d+)\s*(?:x|:|-)\s*(\d+)/i);
    if (!pm) return null;
    const gc = Number(pm[1]);
    const gf = Number(pm[2]);
    if (!Number.isFinite(gc) || !Number.isFinite(gf) || gc > 7 || gf > 7) return null;
    const p = poissonPmf(ctx.lambdaCasa, gc) * poissonPmf(ctx.lambdaFora, gf);
    return { prob: clamp(p, 0.001, 0.6), tipo };
  }

  return null;
}

// Handicap asiático (linhas .5): probabilidade de o lado cobrir.
function probHandicap(lamCasa: number, lamFora: number, lado: "casa" | "fora", handicap: number): number {
  // Enumera placares até 8x8 (>99.9% da massa para lambdas típicos).
  const MAX = 8;
  let p = 0;
  for (let i = 0; i <= MAX; i++) {
    const pi = poissonPmf(lamCasa, i);
    for (let j = 0; j <= MAX; j++) {
      const pj = poissonPmf(lamFora, j);
      const diff = lado === "casa" ? i - j + handicap : j - i + handicap;
      if (diff > 0) p += pi * pj;
    }
  }
  return clamp(p, 0.01, 0.99);
}

function bucketMercado(mercado: string, selecao: string, tipo: MercadoTipo) {
  // Agrupa mercados equivalentes para não trazer picks correlatas demais no mesmo jogo.
  const linha = extrairLinha(selecao);
  if (tipo === "gols" || tipo === "gols_1t" || tipo === "escanteios" || tipo === "cartoes" || tipo === "chutes") {
    return `${tipo}:${linha ?? "linha"}`;
  }
  if (tipo === "handicap") return `handicap:${normKey(selecao)}`;
  if (tipo === "placar") return `placar:${normKey(selecao)}`;
  return tipo === "desconhecido" ? normKey(mercado) : tipo;
}

// ------------------------------------------------------------
// Value, score e filtros finais
// ------------------------------------------------------------
function classificarValor(ev: number): ValorLabel {
  if (ev >= 0.08) return "Excelente Valor";
  if (ev >= 0.04) return "Bom Valor";
  if (ev >= 0.012) return "Valor Moderado";
  return "Sem Valor";
}

function estrelasDaPick(score: number, ev: number, qualidadeDados: number) {
  if (score >= 86 && ev >= 0.06 && qualidadeDados >= 0.65) return 5;
  if (score >= 78 && ev >= 0.035) return 4;
  if (score >= 68 && ev >= 0.015) return 3;
  if (score >= 58 && ev > 0) return 2;
  return 1;
}

function riscoMercado(tipo: MercadoTipo, odd: number) {
  let risco = 0;
  if (tipo === "resultado") risco += 4;
  if (tipo === "cartoes" || tipo === "escanteios" || tipo === "chutes") risco += 3;
  if (tipo === "gols_1t") risco += 5;
  if (tipo === "placar") risco += 8; // placar exato é volátil
  if (tipo === "handicap") risco += 2;
  if (tipo === "dupla" || tipo === "dnb") risco -= 2;
  if (odd >= 3) risco += 5;
  else if (odd >= 2.4) risco += 3;
  else if (odd < 1.25) risco += 4; // odd muito baixa não compensa
  return risco;
}

function scoreFinal(args: {
  prob: number;
  probCalibrada: number;
  odd: number;
  ev: number;
  ctx: Contexto;
  tipo: MercadoTipo;
  lado: "casa" | "fora" | null;
}) {
  const { prob, probCalibrada, odd, ev, ctx, tipo, lado } = args;
  let score = probCalibrada * 100;

  // EV positivo é obrigatório; bônus cresce até um limite.
  score += clamp(ev * 100, -8, 10) * 0.55;

  // Qualidade de dados: evita confiança artificial em jogo pouco informado.
  score += (ctx.qualidadeDados - 0.55) * 16;

  // Forma do lado favorecido.
  const forma = lado === "casa" ? ctx.formaCasa : lado === "fora" ? ctx.formaFora : null;
  if (forma != null) score += (forma - 0.5) * 8;

  // Desfalques do próprio lado vs adversário.
  if (lado === "casa") score += clamp((ctx.nLesFora - ctx.nLesCasa) * 0.8, -4, 4);
  if (lado === "fora") score += clamp((ctx.nLesCasa - ctx.nLesFora) * 0.8, -4, 4);

  // Diferença entre probabilidade pura e calibrada indica instabilidade.
  score -= Math.abs(prob - probCalibrada) * 18;

  if (ctx.escalacaoConfirmada) score += 1.8;
  score -= riscoMercado(tipo, odd);

  return clamp(Math.round(score), 1, 96);
}

function probCalibradaComMercado(probModelo: number, odd: number, qualidadeDados: number) {
  const implicita = clamp(1 / odd, 0.01, 0.98);
  // Quanto menor a qualidade dos dados, maior a regressão para a probabilidade implícita.
  const pesoMercado = clamp(0.12 + (1 - qualidadeDados) * 0.24, 0.12, 0.36);
  return clamp(probModelo * (1 - pesoMercado) + implicita * pesoMercado, 0.01, 0.97);
}

function passaFiltroRigoroso(args: { prob: number; probCalibrada: number; ev: number; odd: number; score: number; tipo: MercadoTipo; qualidadeDados: number }) {
  const { prob, probCalibrada, ev, odd, score, tipo, qualidadeDados } = args;
  if (ev <= 0.005) return false;
  if (odd < 1.22 || odd > 6.5) return false;
  if (prob < 0.18 || probCalibrada < 0.18) return false;
  if (score < 56) return false;
  if (qualidadeDados < 0.45 && tipo !== "dupla" && tipo !== "dnb") return false;
  if ((tipo === "escanteios" || tipo === "cartoes" || tipo === "gols_1t") && score < 62) return false;
  return true;
}

function confiancaPorOddSegura(odd: number) {
  if (odd <= 1.35) return 88;
  if (odd <= 1.6) return 84;
  if (odd <= 1.9) return 78;
  if (odd <= 2.3) return 70;
  return 62;
}

// Fallback quando o motor não consegue montar contexto estatístico.
// Bloco 1: não gera "Melhor Pick", não infla confiança, não inventa EV,
// e marca cada pick com analysis_quality = "market_only". Os consumidores
// (Melhores Picks, Super Múltipla, Melhores Entradas) filtram esse tipo.
function picksSoOdds(partida: PartidaRow, casa: string): PickAnalise[] {
  const vistos = new Set<string>();
  const picks: PickAnalise[] = [];
  for (const o of partida.odds
    .filter((o) => normKey(o.casa) === normKey(casa) && o.valor >= 1.22 && o.valor <= 3.2)
    .sort((a, b) => a.valor - b.valor)) {
    const mercado = o.mercado || "Resultado Final";
    const selecao = traduzPt(o.selecao);
    const chave = `${normKey(mercado)}|${normKey(selecao)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const implicita = Math.round((1 / o.valor) * 100);
    const conf = Math.max(60, Math.min(90, Math.round(60 + implicita * 0.35)));
    picks.push({
      mercado,
      selecao,
      odd: o.valor,
      confianca: conf,
      probModelo: implicita,
      oddJusta: Number(o.valor.toFixed(2)),
      evPct: 0,
      valorLabel: "Leitura de mercado",
      estrelas: 0,
      motivos: [
        "Dados estatísticos insuficientes",
        `Chance implícita da casa: ${implicita}%`,
      ],
      justificativa:
        "Dados estatísticos insuficientes. Esta seleção foi baseada apenas na leitura das odds e não deve ser tratada como recomendação principal.",
      external_odd_id: o.external_odd_id,
      analysisQuality: "market_only",
      dataQualityScore: 0,
      calculationVersion: CALCULATION_VERSION,
    });
    if (picks.length >= 3) break;
  }
  return picks;
}

function montarMotivos(args: {
  ctx: Contexto;
  prob: number;
  probCalibrada: number;
  ev: number;
  odd: number;
  lado: "casa" | "fora" | null;
  casa: string;
  fora: string;
  mercado: string;
  tipo: MercadoTipo;
}): string[] {
  const { ctx, prob, probCalibrada, ev, odd, lado, casa, fora, mercado, tipo } = args;
  const motivos: string[] = [];
  motivos.push(`Probabilidade do modelo: ${percent(prob)}; calibrada com mercado: ${percent(probCalibrada)}`);
  motivos.push(`Odd justa estimada: ${(1 / probCalibrada).toFixed(2)}; odd da casa: ${odd.toFixed(2)}`);
  if (ev > 0) motivos.push(`Value bet positiva: +${Math.round(ev * 100)}% de EV`);

  if (tipo === "gols" || tipo === "btts" || tipo === "time_gol") {
    motivos.push(`Gols esperados: ${round1(ctx.lambdaTotal)} (${casa} ${round1(ctx.lambdaCasa)} x ${fora} ${round1(ctx.lambdaFora)})`);
  }
  if (tipo === "resultado" || tipo === "dupla" || tipo === "dnb") {
    motivos.push(`Força relativa: Elo proxy ${Math.round(ctx.eloCasa)} x ${Math.round(ctx.eloFora)}`);
  }
  if (tipo === "escanteios") motivos.push(`Modelo de escanteios projeta ~${round1(ctx.lambdaEscanteios)} cantos`);
  if (tipo === "cartoes") motivos.push(`Modelo de cartões projeta ~${round1(ctx.lambdaCartoes)} cartões`);
  if (tipo === "gols_1t") motivos.push(`1º tempo projetado em ~${round1(ctx.lambda1t)} gol(s)`);

  if (lado === "casa" && ctx.formaCasa != null) motivos.push(`${casa}: forma recente ponderada ${percent(ctx.formaCasa)}`);
  if (lado === "fora" && ctx.formaFora != null) motivos.push(`${fora}: forma recente ponderada ${percent(ctx.formaFora)}`);
  if (lado === "casa" && ctx.nLesFora > ctx.nLesCasa) motivos.push(`${fora} tem mais desfalques que ${casa}`);
  if (lado === "fora" && ctx.nLesCasa > ctx.nLesFora) motivos.push(`${casa} tem mais desfalques que ${fora}`);
  if (ctx.escalacaoConfirmada) motivos.push("Escalação confirmada aumenta a confiabilidade");
  if (ctx.importancia.rotulo && (tipo === "cartoes" || tipo === "resultado")) motivos.push(ctx.importancia.rotulo);
  motivos.push(`Qualidade dos dados: ${percent(ctx.qualidadeDados)}`);

  // Remove duplicados preservando ordem.
  return [...new Set(motivos)].slice(0, 7);
}

// ------------------------------------------------------------
// API pública do motor
// ------------------------------------------------------------
export function analisarLocal(partida: PartidaRow, casa: string): AnalisePartida {
  const analise: AnaliseJogoStats = analiseDeEstatisticas(partida);
  const oddsCasa = partida.odds.filter((o) => normKey(o.casa) === normKey(casa));

  const ctx = montarContexto(partida);
  if (!ctx) return { picks: picksSoOdds(partida, casa), analise };

  type Cand = PickAnalise & { _score: number; _ev: number; _bucket: string; _tipo: MercadoTipo; _prob: number };
  const porBucket = new Map<string, Cand>();

  for (const o of oddsCasa) {
    if (!Number.isFinite(o.valor) || o.valor < 1.15 || o.valor > 8) continue;

    const parsed = probDaSelecao(o.mercado || "", o.selecao || "", ctx, partida.time_casa, partida.time_fora);
    if (!parsed || !Number.isFinite(parsed.prob) || parsed.prob <= 0) continue;

    const probModelo = clamp(parsed.prob, 0.01, 0.97);
    const probCal = probCalibradaComMercado(probModelo, o.valor, ctx.qualidadeDados);
    const ev = probCal * o.valor - 1;
    const lado = ladoDaSelecao(o.selecao, partida.time_casa, partida.time_fora);
    const score = scoreFinal({ prob: probModelo, probCalibrada: probCal, odd: o.valor, ev, ctx, tipo: parsed.tipo, lado });

    if (!passaFiltroRigoroso({ prob: probModelo, probCalibrada: probCal, ev, odd: o.valor, score, tipo: parsed.tipo, qualidadeDados: ctx.qualidadeDados })) continue;

    const motivos = montarMotivos({
      ctx,
      prob: probModelo,
      probCalibrada: probCal,
      ev,
      odd: o.valor,
      lado,
      casa: partida.time_casa,
      fora: partida.time_fora,
      mercado: o.mercado || "",
      tipo: parsed.tipo,
    });

    // Bloco 1: classifica a qualidade da análise da pick a partir do índice
    // de qualidade dos dados do jogo (ctx.qualidadeDados: 0..1).
    const dataQualityScore = Math.round(clamp(ctx.qualidadeDados, 0, 1) * 100);
    const analysisQuality: AnalysisQuality = dataQualityScore >= 75 ? "complete" : "partial";

    const cand: Cand = {
      mercado: o.mercado || "Resultado Final",
      selecao: traduzPt(o.selecao),
      odd: o.valor,
      confianca: score,
      probModelo: Math.round(probCal * 100),
      oddJusta: Number((1 / probCal).toFixed(2)),
      evPct: Number((ev * 100).toFixed(1)),
      valorLabel: classificarValor(ev),
      estrelas: estrelasDaPick(score, ev, ctx.qualidadeDados),
      motivos,
      justificativa: motivos.join(" • "),
      external_odd_id: o.external_odd_id,
      analysisQuality,
      dataQualityScore,
      calculationVersion: CALCULATION_VERSION,
      _score: score,
      _ev: ev,
      _bucket: bucketMercado(o.mercado || "", o.selecao || "", parsed.tipo),
      _tipo: parsed.tipo,
      _prob: probCal,
    };

    const atual = porBucket.get(cand._bucket);
    // Melhor pick por bucket = score + EV + probabilidade, não só probabilidade.
    const rank = cand._score * 1.1 + cand._ev * 100 + cand._prob * 18;
    const rankAtual = atual ? atual._score * 1.1 + atual._ev * 100 + atual._prob * 18 : -Infinity;
    if (!atual || rank > rankAtual) porBucket.set(cand._bucket, cand);
  }

  const candidatos = [...porBucket.values()].sort((a, b) =>
    (b.estrelas ?? 0) - (a.estrelas ?? 0) || b._score - a._score || b._ev - a._ev || b._prob - a._prob,
  );

  // Diversificação: evita encher com mercados muito correlacionados.
  const picks: Cand[] = [];
  const usadosTipo = new Map<MercadoTipo, number>();
  for (const c of candidatos) {
    const usados = usadosTipo.get(c._tipo) ?? 0;
    if (usados >= 2) continue;
    if ((c._tipo === "gols" || c._tipo === "btts" || c._tipo === "time_gol") && picks.some((p) => p._tipo === c._tipo && Math.abs(p._prob - c._prob) < 0.05)) continue;
    picks.push(c);
    usadosTipo.set(c._tipo, usados + 1);
    if (picks.length >= 6) break;
  }

  if (!picks.length) {
    // Último fallback: não inventa valor. Entrega leitura conservadora por odds.
    return { picks: picksSoOdds(partida, casa), analise };
  }

  return {
    picks: picks.map(({ _score, _ev, _bucket, _tipo, _prob, ...p }) => p),
    analise,
  };
}
