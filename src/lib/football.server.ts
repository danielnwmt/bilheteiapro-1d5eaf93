// Sincronização de jogos direto da API-Football (v3) para o banco.
// Server-only: usa a service key e a chave da API-Football.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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
  const key = process.env.API_FOOTBALL_KEY;
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

  const rows = fixtures.map((f) => ({
    external_id: String(f.fixture.id),
    liga: LEAGUE_ID_TO_NAME[f.league.id] ?? f.league.name,
    time_casa: f.teams.home.name,
    time_fora: f.teams.away.name,
    inicio: f.fixture.date,
    status: STATUS_MAP[f.fixture.status.short] ?? "agendado",
  }));

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
  const key = process.env.API_FOOTBALL_KEY;
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

  const rows: Array<{
    partida_id: string;
    casa: string;
    mercado: string;
    selecao: string;
    valor: number;
    external_odd_id: string | null;
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
