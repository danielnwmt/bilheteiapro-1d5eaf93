// Sincronização de jogos direto da API-Football (v3) para o banco.
// Server-only: usa a service key e a chave da API-Football.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getConfigKey } from "./system-config.server";
import { registrarChamada } from "./api-usage.server";

const API_BASE = "https://v3.football.api-sports.io";

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
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; name: string };
  teams: { home: { name: string }; away: { name: string } };
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
  const key = await getConfigKey("API_FOOTBALL_KEY");
  if (!key) throw new Error("Missing API_FOOTBALL_KEY");

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
      inicio: f.fixture.date,
      status: STATUS_MAP[f.fixture.status.short] ?? "agendado",
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
function mapBetValue(betName: string, value: string, jogoCasa: string, jogoFora: string) {
  const bn = betName.toLowerCase();
  const v = value.toLowerCase();
  // Match Winner
  if (bn === "match winner" || bn === "1x2" || bn === "fulltime result") {
    if (v === "home") return { mercado: "Resultado Final", selecao: `Vitória ${jogoCasa}` };
    if (v === "away") return { mercado: "Resultado Final", selecao: `Vitória ${jogoFora}` };
    if (v === "draw") return { mercado: "Resultado Final", selecao: "Empate" };
  }
  // Goals Over/Under
  if (bn === "goals over/under" || bn === "over/under") {
    return { mercado: "Total de Gols", selecao: value };
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
  return null;
}

const WANTED_BETS = new Set([
  "match winner",
  "1x2",
  "fulltime result",
  "goals over/under",
  "over/under",
  "both teams to score",
  "btts",
  "double chance",
]);

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
  const key = await getConfigKey("API_FOOTBALL_KEY");
  if (!key) throw new Error("Missing API_FOOTBALL_KEY");

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
      if (!WANTED_BETS.has(bet.name.toLowerCase())) continue;
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
    .upsert(rows, { onConflict: "partida_id,casa,mercado,selecao" });

  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

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
 * Coleta as odds disponíveis de TODAS as partidas do dia fazendo
 * apenas UMA chamada por liga (em vez de uma por jogo).
 *
 * 1. Lê as partidas de "hoje" no banco e descobre quais ligas têm jogos.
 * 2. Para cada liga, chama /odds?date=...&league=...&season=... (com paginação).
 * 3. Mapeia o fixture (external_id) -> partida interna e grava as odds.
 *
 * Retorna { ligas, chamadas, odds } com a contagem do processamento.
 */
export async function syncOddsByLeagueToday(
  casa: string = "betano",
): Promise<{ ligas: number; chamadas: number; odds: number }> {
  const key = await getConfigKey("API_FOOTBALL_KEY");
  if (!key) throw new Error("Missing API_FOOTBALL_KEY");

  const supabase = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const date = spDateString(0);
  const start = `${date}T00:00:00-03:00`;
  const end = `${date}T23:59:59-03:00`;

  // Partidas de hoje com external_id (agendadas ou ao vivo).
  const { data: partidas, error: pErr } = await supabase
    .from("partidas")
    .select("id, external_id, liga, time_casa, time_fora")
    .gte("inicio", start)
    .lte("inicio", end)
    .not("external_id", "is", null);

  if (pErr) throw new Error(`Erro ao ler partidas: ${pErr.message}`);
  if (!partidas?.length) return { ligas: 0, chamadas: 0, odds: 0 };

  // Indexa partidas por external_id (fixture id da API).
  const byFixture = new Map<string, (typeof partidas)[number]>();
  for (const p of partidas) {
    if (p.external_id) byFixture.set(String(p.external_id), p);
  }

  // Descobre as ligas com jogos hoje (que estão mapeadas para um id).
  const ligaIds = new Set<number>();
  for (const p of partidas) {
    const id = p.liga ? LEAGUE_NAME_TO_ID[p.liga] : undefined;
    if (id) ligaIds.add(id);
  }

  const casaNorm = normCasa(casa);
  const bookmakerId = BOOKMAKER_NAME_TO_ID[casaNorm];
  const season = seasonForDate(date);

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

  let chamadas = 0;

  // Uma chamada por liga (com paginação interna da API).
  for (const leagueId of ligaIds) {
    let page = 1;
    let totalPages = 1;
    do {
      let resp: ApiOddResponse[];
      let raw: { paging?: { current: number; total: number } } = {};
      try {
        const q = bookmakerId ? `&bookmaker=${bookmakerId}` : "";
        const res = await fetch(
          `${API_BASE}/odds?date=${date}&league=${leagueId}&season=${season}${q}&page=${page}&timezone=America/Sao_Paulo`,
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
        console.error("Falha ao buscar odds da liga", leagueId, "pág", page, e);
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
          if (!WANTED_BETS.has(bet.name.toLowerCase())) continue;
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

  if (!rows.length) return { ligas: ligaIds.size, chamadas, odds: 0 };

  const { error } = await supabase
    .from("odds")
    .upsert(rows, { onConflict: "partida_id,casa,mercado,selecao" });

  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

  return { ligas: ligaIds.size, chamadas, odds: rows.length };
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
    const lado = name.startsWith("over") ? "Over" : name.startsWith("under") ? "Under" : o.name;
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

/**
 * API 2 — The Odds API (1x por dia).
 * 1. Lê as partidas de hoje (gravadas pela API-Football / API 1).
 * 2. Descobre as ligas com jogos e mapeia para os sport keys da Odds API.
 * 3. Faz UMA chamada por liga buscando odds + deep links das casas.
 * 4. Casa cada evento com a partida (por times/data) e grava em "odds".
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

  const date = spDateString(0);
  const start = `${date}T00:00:00-03:00`;
  const end = `${date}T23:59:59-03:00`;

  const { data: partidas, error: pErr } = await supabase
    .from("partidas")
    .select("id, liga, time_casa, time_fora, inicio")
    .gte("inicio", start)
    .lte("inicio", end);

  if (pErr) throw new Error(`Erro ao ler partidas: ${pErr.message}`);
  if (!partidas?.length) return { ligas: 0, chamadas: 0, eventos: 0, odds: 0 };

  // Agrupa partidas por sport key da Odds API (separando ligas com jogos).
  const porSport = new Map<string, typeof partidas>();
  for (const p of partidas) {
    const sport = p.liga ? LEAGUE_NAME_TO_ODDS_SPORT[p.liga] : undefined;
    if (!sport) continue;
    const arr = porSport.get(sport) ?? [];
    arr.push(p);
    porSport.set(sport, arr);
  }

  const casaNorm = normCasa(casa);
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

  let chamadas = 0;
  let eventos = 0;

  for (const [sport, lista] of porSport) {
    let events: OddsApiEvent[];
    try {
      const url =
        `${ODDS_API_BASE}/sports/${sport}/odds/?apiKey=${apiKey}` +
        `&regions=eu,uk&markets=h2h,totals,btts,double_chance` +
        `&oddsFormat=decimal&dateFormat=iso&includeLinks=true&includeSids=true`;
      const res = await fetch(url);
      chamadas++;
      if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`);
      events = (await res.json()) as OddsApiEvent[];
    } catch (e) {
      console.error("Falha ao buscar odds (Odds API) da liga", sport, e);
      continue;
    }

    for (const ev of events) {
      // Casa o evento com uma partida do banco (times + mesmo dia).
      const f = lista.find(
        (p) => teamsMatch(p.time_casa, ev.home_team) && teamsMatch(p.time_fora, ev.away_team),
      );
      if (!f) continue;
      eventos++;

      const bm =
        ev.bookmakers.find((b) => normCasa(b.key) === casaNorm || normCasa(b.title) === casaNorm) ??
        ev.bookmakers[0];
      if (!bm) continue;

      for (const market of bm.markets) {
        for (const o of market.outcomes) {
          const mapped = mapOddsApiOutcome(
            market.key,
            o,
            ev.home_team,
            ev.away_team,
            f.time_casa,
            f.time_fora,
          );
          if (!mapped) continue;
          const valor = Number(o.price);
          if (!Number.isFinite(valor)) continue;
          const deep =
            o.link ?? market.link ?? bm.link ?? resolveDeep(mapped.mercado, f.time_casa, f.time_fora);
          rows.push({
            partida_id: f.id,
            casa,
            mercado: mapped.mercado,
            selecao: mapped.selecao,
            valor,
            external_odd_id: `${ev.id}:${bm.key}:${market.key}:${o.name}`,
            deep_link: deep,
          });
        }
      }
    }
  }

  if (!rows.length) return { ligas: porSport.size, chamadas, eventos, odds: 0 };

  const { error } = await supabase
    .from("odds")
    .upsert(rows, { onConflict: "partida_id,casa,mercado,selecao" });

  if (error) throw new Error(`Erro ao gravar odds: ${error.message}`);

  return { ligas: porSport.size, chamadas, eventos, odds: rows.length };
}
