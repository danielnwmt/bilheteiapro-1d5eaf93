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
