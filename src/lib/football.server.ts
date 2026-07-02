// Sincronização de jogos direto da API-Football (v3) para o banco.
// Server-only: usa a service key e a chave da API-Football.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getConfigKey } from "./system-config.server";
import { registrarChamada } from "./api-usage.server";

const API_BASE = "https://v3.football.api-sports.io";
export const MISSING_API_FOOTBALL_KEY = "Missing API_FOOTBALL_KEY";

export async function hasApiFootballKey(): Promise<boolean> {
  return Boolean(await getConfigKey("API_FOOTBALL_KEY"));
}

async function getApiFootballKey(): Promise<string> {
  const key = await getConfigKey("API_FOOTBALL_KEY");
  if (!key) throw new Error(MISSING_API_FOOTBALL_KEY);
  return key;
}

// Remove odds duplicadas no MESMO lote pela chave de conflito do upsert.
// Sem isso o Postgres lança "ON CONFLICT DO UPDATE command cannot affect row
// a second time" quando o mesmo jogo/casa/mercado/seleção aparece 2x no lote.
function dedupeOdds<T extends { partida_id: string; casa: string; mercado: string; selecao: string }>(
  rows: T[],
): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    map.set(`${r.partida_id}|${r.casa}|${r.mercado}|${r.selecao}`, r);
  }
  return Array.from(map.values());
}

// Mapeia o ID de liga da API-Football -> nome usado no app (coluna "liga").
const LEAGUE_ID_TO_NAME: Record<number, string> = {
  71: "Brasileirão Série A",
  72: "Brasileirão Série B",
  73: "Copa do Brasil",
  13: "Libertadores",
  11: "Sul-Americana",
  39: "Premier League",
  140: "La Liga",
  135: "Serie A (Itália)",
  78: "Bundesliga",
  61: "Ligue 1",
  2: "Champions League",
  3: "Europa League",
  848: "Conference League",
  1: "Copa do Mundo",
};

type Periodo = "hoje" | "amanha" | "semana" | "aovivo";

function spDateString(offsetDays = 0) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function datesForPeriodo(periodo: Periodo): string[] {
  if (periodo === "hoje") return [spDateString(0)];
  if (periodo === "amanha") return [spDateString(1)];
  if (periodo === "semana") return Array.from({ length: 8 }, (_, i) => spDateString(i));
  return []; // aovivo usa ?live=all
}

interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string }; referee?: string | null };
  league: { id: number; name: string };
  teams: { home: { name: string; logo?: string }; away: { name: string; logo?: string } };
}

async function apiGet(path: string, key: string): Promise<ApiFixture[]> {
  await registrarChamada("API_FOOTBALL_KEY");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-apisports-key": key },
  });
  if (!res.ok) {
    throw new Error(`API-Football ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { errors?: unknown; response?: ApiFixture[] };
  if (json.errors && Array.isArray(json.errors) ? json.errors.length : json.errors && Object.keys(json.errors).length) {
    throw new Error(`API-Football erro: ${JSON.stringify(json.errors)}`);
  }
  return json.response ?? [];
}

// Espaça as chamadas à API-Football para não disparar várias por segundo
// (evita estourar o limite por minuto do plano). ~300ms = no máx. ~3 req/s.
const API_THROTTLE_MS = 300;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const STATUS_MAP: Record<string, string> = {
  NS: "agendado",
  TBD: "agendado",
  "1H": "ao_vivo",
  HT: "ao_vivo",
  "2H": "ao_vivo",
  ET: "ao_vivo",
  P: "ao_vivo",
  LIVE: "ao_vivo",
  FT: "encerrado",
  AET: "encerrado",
  PEN: "encerrado",
};

/**
 * Busca jogos na API-Football para o período e grava em "partidas".
 * Retorna a quantidade de partidas sincronizadas.
 */
export async function syncFixtures(periodo: Periodo): Promise<number> {
  const key = await getApiFootballKey();

  const fixtures: ApiFixture[] = [];
  if (periodo === "aovivo") {
    fixtures.push(...(await apiGet(`/fixtures?live=all`, key)));
  } else {
    const dates = datesForPeriodo(periodo);
    for (const d of dates) {
      fixtures.push(...(await apiGet(`/fixtures?date=${d}&timezone=America/Sao_Paulo`, key)));
    }
  }

  if (!fixtures.length) return 0;

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Mantém apenas os campeonatos suportados no app (os da tela).
  const rows = fixtures
    .filter((f) => LEAGUE_ID_TO_NAME[f.league.id])
    .map((f) => ({
      external_id: String(f.fixture.id),
      liga: LEAGUE_ID_TO_NAME[f.league.id],
      time_casa: f.teams.home.name,
      time_fora: f.teams.away.name,
      logo_casa: f.teams.home.logo ?? null,
      logo_fora: f.teams.away.logo ?? null,
      inicio: f.fixture.date,
      status: STATUS_MAP[f.fixture.status.short] ?? "agendado",
      arbitro: f.fixture.referee ?? null,
    }));

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("partidas")
    .upsert(rows, { onConflict: "external_id" });

  if (error) throw new Error(`Erro ao gravar partidas: ${error.message}`);

  return rows.length;
}

// ---------- Odds reais ----------

// Mapeia o nome da casa (app) -> bookmaker id da API-Football.
const BOOKMAKER_NAME_TO_ID: Record<string, number> = {
  betano: 22,
  bet365: 8,
  betfair: 2,
  "1xbet": 26,
  pinnacle: 4,
  marathonbet: 7,
};

// Carrega os templates de deep link por casa e devolve uma função que
// monta o link direto para uma partida/mercado.
async function buildDeepLinkResolver(
  supabase: ReturnType<typeof createClient<Database>>,
  casa: string,
) {
  const casaNorm = normCasa(casa);
  const { data } = await supabase.from("deep_links").select("casa, mercado, url_template");
  const templates = (data ?? []).filter((d) => normCasa(d.casa) === casaNorm);

  return (mercado: string, jogoCasa: string, jogoFora: string): string | null => {
    if (!templates.length) return null;
    const especifico = templates.find((t) => t.mercado && normCasa(t.mercado) === normCasa(mercado));
    const generico = templates.find((t) => !t.mercado);
    const tpl = especifico ?? generico ?? templates[0];
    if (!tpl?.url_template) return null;
    const jogo = encodeURIComponent(`${jogoCasa} x ${jogoFora}`);
    return tpl.url_template
      .replace(/\{jogo\}/g, jogo)
      .replace(/\{mercado\}/g, encodeURIComponent(mercado));
  };
}


function normCasa(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

interface ApiOddValue {
  value: string;
  odd: string;
}
interface ApiOddBet {
  id: number;
  name: string;
  values: ApiOddValue[];
}
interface ApiOddBookmaker {
  id: number;
  name: string;
  bets: ApiOddBet[];
}
interface ApiOddResponse {
  fixture: { id: number };
  bookmakers: ApiOddBookmaker[];
}

async function apiGetOdds(path: string, key: string): Promise<ApiOddResponse[]> {
  await registrarChamada("API_FOOTBALL_KEY");
  const res = await fetch(`${API_BASE}${path}`, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`API-Football odds ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: unknown; response?: ApiOddResponse[] };
  const hasErr = json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length);
  if (hasErr) throw new Error(`API-Football odds erro: ${JSON.stringify(json.errors)}`);
  return json.response ?? [];
}

// Traduz os mercados/seleções da API-Football para os nomes usados no app.
function mapBetValue(betName: string, rawValue: unknown, jogoCasa: string, jogoFora: string) {
  const value = String(rawValue ?? "");
  const bn = String(betName ?? "").toLowerCase();
  const v = value.toLowerCase();
  // Match Winner
  if (bn === "match winner" || bn === "1x2" || bn === "fulltime result") {
    if (v === "home") return { mercado: "Resultado Final", selecao: `Vitória ${jogoCasa}` };
    if (v === "away") return { mercado: "Resultado Final", selecao: `Vitória ${jogoFora}` };
    if (v === "draw") return { mercado: "Resultado Final", selecao: "Empate" };
  }
  // Goals Over/Under
  if (bn === "goals over/under" || bn === "over/under") {
    const num = value.replace(/[^0-9.]/g, "");
    const lado = v.startsWith("over") ? "Mais de" : v.startsWith("under") ? "Menos de" : value;
    return { mercado: "Total de Gols", selecao: num ? `${lado} ${num}` : lado };
  }
  // Both Teams to Score
  if (bn === "both teams to score" || bn === "btts") {
    return { mercado: "Ambas Marcam", selecao: v === "yes" ? "Sim" : "Não" };
  }
  // Double Chance
  if (bn === "double chance") {
    const map: Record<string, string> = {
      "home/draw": `${jogoCasa} ou Empate`,
      "home/away": `${jogoCasa} ou ${jogoFora}`,
      "draw/away": `Empate ou ${jogoFora}`,
    };
    return { mercado: "Dupla Chance", selecao: map[v] ?? value };
  }
  // Draw No Bet / Empate Anula
  if (bn === "draw no bet" || bn === "dnb") {
    if (v === "home") return { mercado: "Empate Anula (DNB)", selecao: `Vitória ${jogoCasa}` };
    if (v === "away") return { mercado: "Empate Anula (DNB)", selecao: `Vitória ${jogoFora}` };
  }
  // Escanteios (Corners Over/Under, Total Corners)
  if (bn.includes("corner")) {
    if (v.startsWith("over") || v.startsWith("under")) {
      const num = value.replace(/[^0-9.]/g, "");
      const lado = v.startsWith("over") ? "Mais de" : "Menos de";
      return { mercado: "Escanteios", selecao: num ? `${lado} ${num} escanteios` : lado };
    }
    // Handicap/linha (ex.: "Home +1.5") — o número já está no valor, não duplica.
    return { mercado: "Escanteios", selecao: `${value} escanteios` };
  }
  // Cartões (Cards Over/Under, Total Cards)
  if (bn.includes("card")) {
    if (v.startsWith("over") || v.startsWith("under")) {
      const num = value.replace(/[^0-9.]/g, "");
      const lado = v.startsWith("over") ? "Mais de" : "Menos de";
      return { mercado: "Cartões", selecao: num ? `${lado} ${num} cartões` : lado };
    }
    return { mercado: "Cartões", selecao: `${value} cartões` };
  }
  // Handicap Asiático
  if (bn.includes("asian handicap") || bn === "handicap") {
    return { mercado: "Handicap Asiático", selecao: value };
  }
  // Placar Exato (Exact/Correct Score)
  if (bn === "exact score" || bn === "correct score") {
    return { mercado: "Placar Exato", selecao: value };
  }
  // Gols no 1º Tempo (Goals Over/Under First Half)
  if (bn.includes("first half") && (bn.includes("over") || bn.includes("goals"))) {
    const num = value.replace(/[^0-9.]/g, "");
    const lado = v.startsWith("over") ? "Mais de" : v.startsWith("under") ? "Menos de" : value;
    return { mercado: "Gols no 1º Tempo", selecao: num ? `${lado} ${num} (1ºT)` : lado };
  }
  // Time Marca Gol (To Score / Team To Score)
  if (bn.includes("to score")) {
    if (bn.includes("home") || v === "home") return { mercado: "Time Marca Gol", selecao: `${jogoCasa} marca` };
    if (bn.includes("away") || v === "away") return { mercado: "Time Marca Gol", selecao: `${jogoFora} marca` };
    return { mercado: "Time Marca Gol", selecao: v === "yes" ? "Sim" : v === "no" ? "Não" : value };
  }
  return null;
}

const WANTED_BETS_KEYWORDS = [
  "match winner",
  "1x2",
  "fulltime result",
  "goals over/under",
  "over/under",
  "both teams to score",
  "btts",
  "double chance",
  "draw no bet",
  "corner",
  "card",
  "asian handicap",
  "exact score",
  "correct score",
  "first half",
  "to score",
];

function betQuerido(name: string): boolean {
  const n = String(name ?? "").toLowerCase();
  return WANTED_BETS_KEYWORDS.some((k) => n.includes(k));
}

/**
 * Busca odds reais na API-Football para as partidas indicadas e grava em "odds".
 * fixtures: lista de { id (uuid interno), external_id, time_casa, time_fora }.
 * Retorna a quantidade de odds gravadas.
 */
export async function syncOdds(
  fixtures: Array<{ id: string; external_id: string | null; time_casa: string; time_fora: string }>,
  casa: string,
  maxFixtures = 12,
): Promise<number> {
  const key = await getApiFootballKey();

  const targets = fixtures.filter((f) => f.external_id).slice(0, maxFixtures);
  if (!targets.length) return 0;

  const casaNorm = normCasa(casa);
  const bookmakerId = BOOKMAKER_NAME_TO_ID[casaNorm];

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const resolveDeep = await buildDeepLinkResolver(supabase, casa);

  const rows: Array<{
    partida_id: string;
    casa: string;
    mercado: string;
    selecao: string;
    valor: number;
    external_odd_id: string | null;
    deep_link: string | null;
  }> = [];

  for (const f of targets) {
    let resp: ApiOddResponse[];
    try {
      const q = bookmakerId ? `&bookmaker=${bookmakerId}` : "";
      resp = await apiGetOdds(`/odds?fixture=${f.external_id}${q}`, key);
    } catch (e) {
      console.error("Falha ao buscar odds da partida", f.external_id, e);
      continue;
    }

    const entry = resp[0];
    if (!entry) continue;

    // Escolhe o bookmaker: preferido por id/nome, senão o primeiro.
    const bm =
      entry.bookmakers.find((b) => b.id === bookmakerId || normCasa(b.name) === casaNorm) ??
      entry.bookmakers[0];
    if (!bm) continue;

    for (const bet of bm.bets) {
      if (!betQuerido(bet.name)) continue;
      for (const val of bet.values) {
        const mapped = mapBetValue(bet.name, val.value, f.time_casa, f.time_fora);
        if (!mapped) continue;
        const valor = Number(val.odd);
        if (!Number.isFinite(valor)) continue;
        rows.push({
          partida_id: f.id,
          casa,
          mercado: mapped.mercado,
          selecao: mapped.selecao,
          valor,
          external_odd_id: `${f.external_id}:${bm.id}:${bet.id}:${val.value}`,
          deep_link: resolveDeep(mapped.mercado, f.time_casa, f.time_fora),
        });
      }
    }
  }

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("odds")
    .upsert(dedupeOdds(rows), { onConflict: "partida_id,casa,mercado,selecao" });

  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

  return rows.length;
}

// ---------- Coleta de estatísticas reais (API-Football /predictions) ----------

interface ApiCardBucket {
  total?: number | null;
  percentage?: string | null;
}

interface ApiPredLeague {
  form?: string | null;
  fixtures?: { played?: { total?: number | null } | null } | null;
  cards?: {
    yellow?: Record<string, ApiCardBucket> | null;
    red?: Record<string, ApiCardBucket> | null;
  } | null;
}

interface ApiPredTeam {
  last_5?: {
    form?: string | null;
    goals?: {
      for?: { total?: number | null; average?: string | null } | null;
      against?: { total?: number | null; average?: string | null } | null;
    } | null;
  } | null;
  league?: ApiPredLeague | null;
}

interface ApiPredResponse {
  predictions?: {
    winner?: { name?: string | null; comment?: string | null } | null;
    under_over?: string | null;
    goals?: { home?: string | null; away?: string | null } | null;
    advice?: string | null;
    percent?: { home?: string; draw?: string; away?: string } | null;
  } | null;
  teams?: { home?: ApiPredTeam | null; away?: ApiPredTeam | null } | null;
}

// Resumo compacto das estatísticas reais salvo em estatisticas.payload e enviado à IA.
export interface EstatisticasResumo {
  advice: string | null;
  underOver: string | null;
  golsPrev: { casa: string | null; fora: string | null };
  percent: { casa: string | null; empate: string | null; fora: string | null };
  formaCasa: string | null;
  formaFora: string | null;
  golsFeitosCasa: string | null;
  golsSofridosCasa: string | null;
  golsFeitosFora: string | null;
  golsSofridosFora: string | null;
  cartoesCasa: string | null;
  cartoesFora: string | null;
  cartoesConfronto: string | null;
  // Lesões / suspensões / desfalques (API-Football /injuries) e escalação
  // oficial confirmada (API-Football /fixtures/lineups). Tratados localmente.
  lesoesCasa: string[];
  lesoesFora: string[];
  escalacaoConfirmada: boolean;
}

// Normaliza nome de time para casar lesões com o lado certo do confronto.
function nkeyTime(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface ApiInjuryResponse {
  player?: { id?: number | null; name?: string | null } | null;
  team?: { id?: number | null; name?: string | null } | null;
  type?: string | null;
  reason?: string | null;
}

// Lesões / suspensões de um jogo. Não lança erro — sem dados retorna [].
async function apiGetInjuries(fixtureId: string, key: string): Promise<ApiInjuryResponse[]> {
  await registrarChamada("API_FOOTBALL_KEY");
  try {
    const res = await fetch(`${API_BASE}/injuries?fixture=${fixtureId}`, {
      headers: { "x-apisports-key": key },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { response?: ApiInjuryResponse[] };
    return json.response ?? [];
  } catch {
    return [];
  }
}

// Escalação oficial: > 0 quando os times já divulgaram a escalação confirmada.
async function apiGetLineupsCount(fixtureId: string, key: string): Promise<number> {
  await registrarChamada("API_FOOTBALL_KEY");
  try {
    const res = await fetch(`${API_BASE}/fixtures/lineups?fixture=${fixtureId}`, {
      headers: { "x-apisports-key": key },
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { response?: unknown[] };
    return json.response?.length ?? 0;
  } catch {
    return 0;
  }
}


async function apiGetPredictions(fixtureId: string, key: string): Promise<ApiPredResponse[]> {
  await registrarChamada("API_FOOTBALL_KEY");
  const res = await fetch(`${API_BASE}/predictions?fixture=${fixtureId}`, {
    headers: { "x-apisports-key": key },
  });
  if (!res.ok) throw new Error(`API-Football predictions ${res.status}`);
  const json = (await res.json()) as { errors?: unknown; response?: ApiPredResponse[] };
  const hasErr =
    json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length);
  if (hasErr) throw new Error(`API-Football predictions erro: ${JSON.stringify(json.errors)}`);
  return json.response ?? [];
}

// Média de cartões por jogo (amarelos + vermelhos) a partir do resumo de temporada.
function mediaCartoes(lg?: ApiPredLeague | null): string | null {
  if (!lg?.cards) return null;
  const jogos = lg.fixtures?.played?.total ?? 0;
  if (!jogos) return null;
  const somaBuckets = (b?: Record<string, ApiCardBucket> | null) =>
    b ? Object.values(b).reduce((acc, v) => acc + (v?.total ?? 0), 0) : 0;
  const total = somaBuckets(lg.cards.yellow) + somaBuckets(lg.cards.red);
  if (!total) return null;
  return (total / jogos).toFixed(1);
}

// Últimos 10 resultados a partir da string de forma da temporada (ex.: "WDLWW...").
function ultimos10(lg?: ApiPredLeague | null, fallback?: string | null): string | null {
  const full = lg?.form ?? null;
  if (full) return full.slice(-10);
  return fallback ?? null;
}

function resumirPredicao(p: ApiPredResponse): EstatisticasResumo {
  const pr = p.predictions ?? {};
  const h = p.teams?.home?.last_5 ?? {};
  const a = p.teams?.away?.last_5 ?? {};
  const hl = p.teams?.home?.league ?? null;
  const al = p.teams?.away?.league ?? null;
  const cartCasa = mediaCartoes(hl);
  const cartFora = mediaCartoes(al);
  const confronto =
    cartCasa != null && cartFora != null
      ? (Number(cartCasa) + Number(cartFora)).toFixed(1)
      : null;
  return {
    advice: pr.advice ?? null,
    underOver: pr.under_over ?? null,
    golsPrev: { casa: pr.goals?.home ?? null, fora: pr.goals?.away ?? null },
    percent: { casa: pr.percent?.home ?? null, empate: pr.percent?.draw ?? null, fora: pr.percent?.away ?? null },
    formaCasa: ultimos10(hl, h.form),
    formaFora: ultimos10(al, a.form),
    golsFeitosCasa: h.goals?.for?.average ?? null,
    golsSofridosCasa: h.goals?.against?.average ?? null,
    golsFeitosFora: a.goals?.for?.average ?? null,
    golsSofridosFora: a.goals?.against?.average ?? null,
    cartoesCasa: cartCasa,
    cartoesFora: cartFora,
    cartoesConfronto: confronto,
    lesoesCasa: [],
    lesoesFora: [],
    escalacaoConfirmada: false,
  };
}

/**
 * Coleta estatísticas reais (endpoint /predictions da API-Football) para as
 * partidas indicadas e grava em public.estatisticas (tipo "predicoes").
 * Também busca lesões/desfalques (/injuries) e a escalação oficial
 * (/fixtures/lineups) e trata tudo localmente. Retorna quantos jogos foram salvos.
 */
export async function syncEstatisticas(
  fixtures: Array<{ id: string; external_id: string | null; time_casa?: string; time_fora?: string }>,
  maxFixtures = 60,
): Promise<number> {
  const key = await getApiFootballKey();

  const targets = fixtures.filter((f) => f.external_id).slice(0, maxFixtures);
  if (!targets.length) return 0;

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rows: Array<{ partida_id: string; tipo: string; payload: EstatisticasResumo }> = [];
  for (const f of targets) {
    try {
      const resp = await apiGetPredictions(String(f.external_id), key);
      const entry = resp[0];
      if (!entry) continue;
      const payload = resumirPredicao(entry);

      // Lesões / suspensões / desfalques, divididos por time.
      try {
        const injuries = await apiGetInjuries(String(f.external_id), key);
        const kc = nkeyTime(f.time_casa ?? "");
        const kf = nkeyTime(f.time_fora ?? "");
        const vistos = new Set<string>();
        for (const inj of injuries) {
          const nome = (inj.player?.name ?? "").trim();
          if (!nome) continue;
          const t = nkeyTime(inj.team?.name ?? "");
          const chave = `${t}|${nome}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          if (kc && (t.includes(kc) || kc.includes(t))) payload.lesoesCasa.push(nome);
          else if (kf && (t.includes(kf) || kf.includes(t))) payload.lesoesFora.push(nome);
        }
      } catch (e) {
        console.error("Falha ao buscar lesões da partida", f.external_id, e);
      }

      // Escalação oficial confirmada.
      try {
        payload.escalacaoConfirmada = (await apiGetLineupsCount(String(f.external_id), key)) > 0;
      } catch { /* sem escalação ainda */ }

      rows.push({ partida_id: f.id, tipo: "predicoes", payload });
    } catch (e) {
      console.error("Falha ao buscar estatísticas da partida", f.external_id, e);
    }
  }


  if (!rows.length) return 0;

  const { error } = await supabase
    .from("estatisticas")
    .upsert(rows, { onConflict: "partida_id,tipo" });
  if (error) throw new Error(`Erro ao gravar estatísticas: ${error.message}`);

  return rows.length;
}



// ---------- Coleta de odds 1x por dia, por liga ----------

// Mapa reverso: nome da liga (app) -> id da API-Football.
const LEAGUE_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(LEAGUE_ID_TO_NAME).map(([id, name]) => [name, Number(id)]),
);

// Temporada (ano) usada pela API-Football para uma data.
function seasonForDate(dateStr: string): number {
  return Number(dateStr.slice(0, 4));
}

/**
 * Coleta as odds disponíveis das partidas fazendo apenas UMA chamada por
 * (liga, dia) — em vez de uma por jogo.
 *
 * 1. Lê as partidas dos dias pedidos no banco e descobre as ligas com jogos.
 * 2. Para cada dia e liga, chama /odds?date=...&league=...&season=... (paginado).
 * 3. Mapeia o fixture (external_id) -> partida interna e grava as odds.
 *
 * `dias`: quantos dias a partir de hoje coletar (1 = só hoje, 2 = hoje+amanhã,
 * 8 = a semana inteira). Retorna { ligas, chamadas, odds }.
 */
export async function syncOddsByLeagueDias(
  casa: string = "betano",
  dias: number = 1,
): Promise<{ ligas: number; chamadas: number; odds: number }> {
  const key = await getApiFootballKey();

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const casaNorm = normCasa(casa);
  const bookmakerId = BOOKMAKER_NAME_TO_ID[casaNorm];
  const resolveDeep = await buildDeepLinkResolver(supabase, casa);

  const rows: Array<{
    partida_id: string;
    casa: string;
    mercado: string;
    selecao: string;
    valor: number;
    external_odd_id: string | null;
    deep_link: string | null;
  }> = [];

  const totalDias = Math.max(1, dias);
  const dates = Array.from({ length: totalDias }, (_, i) => spDateString(i));

  let chamadas = 0;
  const ligasVistas = new Set<string>();

  for (const date of dates) {
    const start = `${date}T00:00:00-03:00`;
    const end = `${date}T23:59:59-03:00`;

    // Partidas do dia com external_id (agendadas ou ao vivo).
    const { data: partidas, error: pErr } = await supabase
      .from("partidas")
      .select("id, external_id, liga, time_casa, time_fora")
      .gte("inicio", start)
      .lte("inicio", end)
      .not("external_id", "is", null);

    if (pErr) throw new Error(`Erro ao ler partidas: ${pErr.message}`);
    if (!partidas?.length) continue;

    // Indexa partidas por external_id (fixture id da API).
    const byFixture = new Map<string, (typeof partidas)[number]>();
    for (const p of partidas) {
      if (p.external_id) byFixture.set(String(p.external_id), p);
    }

    // Descobre as ligas com jogos nesse dia (que estão mapeadas para um id).
    const ligaIds = new Set<number>();
    for (const p of partidas) {
      const id = p.liga ? LEAGUE_NAME_TO_ID[p.liga] : undefined;
      if (id) ligaIds.add(id);
    }

    const season = seasonForDate(date);

    // Uma chamada por liga (com paginação interna da API).
    for (const leagueId of ligaIds) {
      ligasVistas.add(`${date}:${leagueId}`);
      let page = 1;
      let totalPages = 1;
      do {
        let resp: ApiOddResponse[];
        let raw: { paging?: { current: number; total: number } } = {};
        try {
          // NÃO filtramos por casa (bookmaker) na chamada: se a casa escolhida
          // não tiver odds para o jogo (comum na Copa do Mundo), a API voltaria
          // vazia. Buscamos TODAS as casas e escolhemos a melhor disponível.
          await registrarChamada("API_FOOTBALL_KEY");
          const res = await fetch(
            `${API_BASE}/odds?date=${date}&league=${leagueId}&season=${season}&page=${page}&timezone=America/Sao_Paulo`,
            { headers: { "x-apisports-key": key } },
          );
          chamadas++;
          if (!res.ok) throw new Error(`API-Football odds ${res.status}: ${await res.text()}`);
          const json = (await res.json()) as {
            errors?: unknown;
            response?: ApiOddResponse[];
            paging?: { current: number; total: number };
          };
          const hasErr =
            json.errors && (Array.isArray(json.errors) ? json.errors.length : Object.keys(json.errors).length);
          if (hasErr) throw new Error(`API-Football odds erro: ${JSON.stringify(json.errors)}`);
          resp = json.response ?? [];
          raw = json;
        } catch (e) {
          console.error("Falha ao buscar odds da liga", leagueId, "dia", date, "pág", page, e);
          break;
        }

        totalPages = raw.paging?.total ?? 1;

        for (const entry of resp) {
          const f = byFixture.get(String(entry.fixture.id));
          if (!f) continue; // fixture não está entre as partidas do banco
          const bm =
            entry.bookmakers.find((b) => b.id === bookmakerId || normCasa(b.name) === casaNorm) ??
            entry.bookmakers[0];
          if (!bm) continue;

          for (const bet of bm.bets) {
            if (!betQuerido(bet.name)) continue;
            for (const val of bet.values) {
              const mapped = mapBetValue(bet.name, val.value, f.time_casa, f.time_fora);
              if (!mapped) continue;
              const valor = Number(val.odd);
              if (!Number.isFinite(valor)) continue;
              rows.push({
                partida_id: f.id,
                casa,
                mercado: mapped.mercado,
                selecao: mapped.selecao,
                valor,
                external_odd_id: `${f.external_id}:${bm.id}:${bet.id}:${val.value}`,
                deep_link: resolveDeep(mapped.mercado, f.time_casa, f.time_fora),
              });
            }
          }
        }

        page++;
      } while (page <= totalPages);
    }
  }

  if (!rows.length) return { ligas: ligasVistas.size, chamadas, odds: 0 };

  const { error } = await supabase
    .from("odds")
    .upsert(dedupeOdds(rows), { onConflict: "partida_id,casa,mercado,selecao" });

  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

  return { ligas: ligasVistas.size, chamadas, odds: rows.length };
}

/** Compat: coleta as odds só de hoje (1 dia). */
export async function syncOddsByLeagueToday(
  casa: string = "betano",
): Promise<{ ligas: number; chamadas: number; odds: number }> {
  return syncOddsByLeagueDias(casa, 1);
}


// ============= API 2: The Odds API (odds + deep links) =============
// https://api.the-odds-api.com — coleta odds e links diretos das casas
// para as ligas que têm jogos hoje (descobertas via API-Football).

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

// Nome da liga (app) -> sport key da The Odds API.
const LEAGUE_NAME_TO_ODDS_SPORT: Record<string, string> = {
  "Brasileirão Série A": "soccer_brazil_campeonato",
  "Brasileirão Série B": "soccer_brazil_serie_b",
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Serie A (Itália)": "soccer_italy_serie_a",
  Bundesliga: "soccer_germany_bundesliga",
  "Ligue 1": "soccer_france_ligue_one",
  "Champions League": "soccer_uefa_champs_league",
  "Europa League": "soccer_uefa_europa_league",
  "Conference League": "soccer_uefa_europa_conference_league",
  Libertadores: "soccer_conmebol_copa_libertadores",
  "Sul-Americana": "soccer_conmebol_copa_sudamericana",
  "Copa do Mundo": "soccer_fifa_world_cup",
};

// Casas exibidas no app. A The Odds API usa keys/títulos próprios (ex.:
// "betfair_ex_uk"), então casamos por inclusão do nome normalizado.
const APP_CASAS = ["Bet365", "Betano", "Superbet", "KTO", "Sportingbet", "Betfair"];

// Resolve o nome de casa do app a partir de um bookmaker da The Odds API.
// Retorna null quando a casa não é uma das exibidas no app.
function resolveAppCasa(bmKey: string, bmTitle: string): string | null {
  const k = normCasa(bmKey);
  const t = normCasa(bmTitle);
  for (const app of APP_CASAS) {
    const a = normCasa(app);
    if (k === a || t === a || k.includes(a) || t.includes(a)) return app;
  }
  return null;
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  link?: string;
  description?: string;
}
interface OddsApiMarket {
  key: string;
  link?: string;
  outcomes: OddsApiOutcome[];
}
interface OddsApiBookmaker {
  key: string;
  title: string;
  link?: string;
  markets: OddsApiMarket[];
}
interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

// Compara dois nomes de time de fontes diferentes (API-Football x Odds API).
function teamsMatch(a: string, b: string): boolean {
  const na = normCasa(a);
  const nb = normCasa(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = na.match(/.{4,}/g) ?? [];
  return ta.some((tok) => nb.includes(tok));
}

// Traduz mercado/seleção da Odds API para os nomes usados no app.
function mapOddsApiOutcome(
  marketKey: string,
  o: OddsApiOutcome,
  eventHome: string,
  eventAway: string,
  jogoCasa: string,
  jogoFora: string,
): { mercado: string; selecao: string } | null {
  const k = marketKey.toLowerCase();
  const name = o.name.toLowerCase();
  if (k === "h2h") {
    if (teamsMatch(o.name, eventHome)) return { mercado: "Resultado Final", selecao: `Vitória ${jogoCasa}` };
    if (teamsMatch(o.name, eventAway)) return { mercado: "Resultado Final", selecao: `Vitória ${jogoFora}` };
    if (name === "draw") return { mercado: "Resultado Final", selecao: "Empate" };
  }
  if (k === "totals") {
    const lado = name.startsWith("over") ? "Mais de" : name.startsWith("under") ? "Menos de" : o.name;
    const pt = o.point != null ? ` ${o.point}` : "";
    return { mercado: "Total de Gols", selecao: `${lado}${pt}` };
  }
  if (k === "btts") {
    return { mercado: "Ambas Marcam", selecao: name === "yes" ? "Sim" : "Não" };
  }
  if (k === "double_chance") {
    if (teamsMatch(o.name, eventHome)) return { mercado: "Dupla Chance", selecao: `${jogoCasa} ou Empate` };
    if (teamsMatch(o.name, eventAway)) return { mercado: "Dupla Chance", selecao: `Empate ou ${jogoFora}` };
    return { mercado: "Dupla Chance", selecao: `${jogoCasa} ou ${jogoFora}` };
  }
  return null;
}

// Sport key da The Odds API -> nome da liga usado no app.
const ODDS_SPORT_TO_LEAGUE: Record<string, string> = Object.fromEntries(
  Object.entries(LEAGUE_NAME_TO_ODDS_SPORT).map(([liga, sport]) => [sport, liga]),
);

/**
 * API 2 — The Odds API.
 * Cria os jogos E as odds a partir da MESMA fonte (cada evento da Odds API já
 * traz times + odds), garantindo que todo jogo exibido tenha odds casadas.
 * 1. Lista as ligas suportadas que estão em temporada (chamada grátis).
 * 2. Para cada liga, busca os eventos com odds e deep links das casas.
 * 3. Cria/atualiza as partidas e grava as odds (reais por casa + consenso).
 */
export async function syncOddsFromOddsApi(
  casa: string = "betano",
): Promise<{ ligas: number; chamadas: number; eventos: number; odds: number }> {
  const apiKey = await getConfigKey("ODDS_API_KEY");
  if (!apiKey) throw new Error("Missing ODDS_API_KEY");

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const now = Date.now();
  const liveFloor = now - 3.5 * 3600_000; // jogos iniciados há até 3,5h ainda contam
  const future = now + 7 * 24 * 3600_000; // próximos 7 dias

  // 1) Descobre quais ligas suportadas estão "em temporada". Essa chamada NÃO
  //    consome a cota de odds; assim só pedimos odds das ligas com jogos ativos.
  let sportsToQuery = Object.values(LEAGUE_NAME_TO_ODDS_SPORT);
  try {
    const sres = await fetch(`${ODDS_API_BASE}/sports/?apiKey=${apiKey}`);
    if (sres.ok) {
      const all = (await sres.json()) as Array<{ key: string; active: boolean }>;
      const ativos = new Set(all.filter((s) => s.active).map((s) => s.key));
      const filtrados = sportsToQuery.filter((k) => ativos.has(k));
      if (filtrados.length) sportsToQuery = filtrados;
    }
  } catch (e) {
    console.error("Odds API: falha ao listar esportes ativos", e);
  }

  const resolveDeep = await buildDeepLinkResolver(supabase, casa);

  type NovaPartida = {
    external_id: string;
    liga: string;
    time_casa: string;
    time_fora: string;
    inicio: string;
    status: string;
  };
  const novasPartidas = new Map<string, NovaPartida>();

  type OddTmp = {
    external_id: string;
    casa: string;
    mercado: string;
    selecao: string;
    valor: number;
    external_odd_id: string;
    deep_link: string | null;
  };
  const oddsTmp: OddTmp[] = [];

  let chamadas = 0;
  let eventos = 0;

  for (const sport of sportsToQuery) {
    const liga = ODDS_SPORT_TO_LEAGUE[sport];
    if (!liga) continue;

    let events: OddsApiEvent[];
    try {
      const url =
        `${ODDS_API_BASE}/sports/${sport}/odds/?apiKey=${apiKey}` +
        `&regions=eu,uk&markets=h2h,totals` +
        `&oddsFormat=decimal&dateFormat=iso&includeLinks=true&includeSids=true`;
      await registrarChamada("ODDS_API_KEY");
      const res = await fetch(url);
      chamadas++;
      if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`);
      events = (await res.json()) as OddsApiEvent[];
    } catch (e) {
      console.error("Falha ao buscar odds (Odds API) da liga", sport, e);
      continue;
    }

    for (const ev of events) {
      const ini = new Date(ev.commence_time).getTime();
      if (!Number.isFinite(ini) || ini < liveFloor || ini > future) continue;
      eventos++;

      const externalId = `oddsapi:${ev.id}`;
      novasPartidas.set(externalId, {
        external_id: externalId,
        liga,
        time_casa: ev.home_team,
        time_fora: ev.away_team,
        inicio: new Date(ini).toISOString(),
        status: ini > now ? "agendado" : "ao_vivo",
      });

      // Consenso (todas as casas) + cotações reais das casas exibidas no app.
      type Cot = { mercado: string; selecao: string; valor: number; deep: string | null; ext: string };
      const consenso = new Map<
        string,
        { mercado: string; selecao: string; valores: number[]; deep: string | null; ext: string }
      >();
      const reais = new Map<string, Cot[]>();

      for (const bm of ev.bookmakers) {
        const appCasa = resolveAppCasa(bm.key, bm.title);
        for (const market of bm.markets) {
          for (const o of market.outcomes) {
            const mapped = mapOddsApiOutcome(
              market.key,
              o,
              ev.home_team,
              ev.away_team,
              ev.home_team,
              ev.away_team,
            );
            if (!mapped) continue;
            const valor = Number(o.price);
            if (!Number.isFinite(valor)) continue;
            const deep = o.link ?? market.link ?? bm.link ?? null;
            const ext = `${ev.id}:${bm.key}:${market.key}:${o.name}`;
            const chave = `${mapped.mercado}||${mapped.selecao}`;

            const c = consenso.get(chave);
            if (c) {
              c.valores.push(valor);
              if (!c.deep && deep) c.deep = deep;
            } else {
              consenso.set(chave, {
                mercado: mapped.mercado,
                selecao: mapped.selecao,
                valores: [valor],
                deep,
                ext,
              });
            }

            if (appCasa) {
              const arr = reais.get(appCasa) ?? [];
              arr.push({ mercado: mapped.mercado, selecao: mapped.selecao, valor, deep, ext });
              reais.set(appCasa, arr);
            }
          }
        }
      }

      if (!consenso.size) continue;

      for (const appCasa of APP_CASAS) {
        const reaisCasa = reais.get(appCasa);
        if (reaisCasa?.length) {
          for (const c of reaisCasa) {
            oddsTmp.push({
              external_id: externalId,
              casa: appCasa,
              mercado: c.mercado,
              selecao: c.selecao,
              valor: c.valor,
              external_odd_id: c.ext,
              deep_link: c.deep ?? resolveDeep(c.mercado, ev.home_team, ev.away_team),
            });
          }
        } else {
          for (const c of consenso.values()) {
            const sorted = [...c.valores].sort((a, b) => a - b);
            const mediana = sorted[Math.floor(sorted.length / 2)];
            oddsTmp.push({
              external_id: externalId,
              casa: appCasa,
              mercado: c.mercado,
              selecao: c.selecao,
              valor: mediana,
              external_odd_id: `${c.ext}:consensus:${normCasa(appCasa)}`,
              deep_link: c.deep ?? resolveDeep(c.mercado, ev.home_team, ev.away_team),
            });
          }
        }
      }
    }
  }

  if (!novasPartidas.size) return { ligas: sportsToQuery.length, chamadas, eventos, odds: 0 };

  // Grava as partidas e recupera os ids (por external_id) para vincular as odds.
  const { error: upErr } = await supabase
    .from("partidas")
    .upsert(Array.from(novasPartidas.values()), { onConflict: "external_id" });
  if (upErr) throw new Error(`Erro ao gravar partidas: ${upErr.message}`);

  const externalIds = Array.from(novasPartidas.keys());
  const idPorExternal = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += 100) {
    const lote = externalIds.slice(i, i + 100);
    const { data } = await supabase.from("partidas").select("id, external_id").in("external_id", lote);
    for (const p of data ?? []) idPorExternal.set(p.external_id as string, p.id as string);
  }

  const rows = oddsTmp
    .map((o) => {
      const pid = idPorExternal.get(o.external_id);
      if (!pid) return null;
      return {
        partida_id: pid,
        casa: o.casa,
        mercado: o.mercado,
        selecao: o.selecao,
        valor: o.valor,
        external_odd_id: o.external_odd_id,
        deep_link: o.deep_link,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return { ligas: sportsToQuery.length, chamadas, eventos, odds: 0 };

  const { error } = await supabase
    .from("odds")
    .upsert(dedupeOdds(rows), { onConflict: "partida_id,casa,mercado,selecao" });
  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

  return { ligas: sportsToQuery.length, chamadas, eventos, odds: rows.length };
}
