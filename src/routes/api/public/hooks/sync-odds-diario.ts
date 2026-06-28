import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOddsFromOddsApi } from "@/lib/football.server";
import { getConfigKey } from "@/lib/system-config.server";

// Robô diário (1x por dia):
// API 1 (API-Football) atualiza as partidas/ligas do dia.
// API 2 (The Odds API) coleta as odds + deep links das casas.
const CASA_PADRAO = "betano";
const INTERVALO_PADRAO_MIN = 60;

async function getIntervaloMin(chave: string): Promise<number> {
  const valorRaw = await getConfigKey(`${chave}_INTERVALO_VALOR`);
  const unidade = (await getConfigKey(`${chave}_INTERVALO_UNIDADE`)) ?? "minutos";
  const valor = Number(valorRaw);
  if (!valor || valor <= 0) return INTERVALO_PADRAO_MIN;
  if (unidade === "segundos") return valor / 60;
  if (unidade === "horas") return valor * 60;
  return valor;
}

async function podeSincronizar(supabaseAdmin: any, id: string, chave: string, now: number) {
  const { data: state, error } = await supabaseAdmin
    .from("sync_state")
    .select("last_sync_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`sync_state ${id} indisponível; bloqueando chamada da API`, error);
    return { ok: false, intervaloMin: await getIntervaloMin(chave), minutesSinceLast: 0 };
  }
  const last = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : 0;
  const minutesSinceLast = (now - last) / 60_000;
  const intervaloMin = await getIntervaloMin(chave);
  return { ok: minutesSinceLast >= intervaloMin, intervaloMin, minutesSinceLast };
}

async function reservarSync(supabaseAdmin: any, id: string, now: number): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("sync_state")
    .upsert({ id, last_sync_at: new Date(now).toISOString() }, { onConflict: "id" });
  if (error) {
    console.error(`Não foi possível gravar sync_state ${id}; chamada da API bloqueada`, error);
    return false;
  }
  return true;
}

export const Route = createFileRoute("/api/public/hooks/sync-odds-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const url = new URL(request.url);
          const casa = url.searchParams.get("casa") ?? CASA_PADRAO;
          const now = Date.now();
          const footballSync = await podeSincronizar(supabaseAdmin, "football", "API_FOOTBALL_KEY", now);
          const oddsApiSync = await podeSincronizar(supabaseAdmin, "odds_api", "ODDS_API_KEY", now);
          const skipped: Record<string, string> = {};

          // API 1: garante as partidas do dia (descobre as ligas com jogos).
          let fixturesHoje = 0;
          if (footballSync.ok) {
            if (await reservarSync(supabaseAdmin, "football", now)) {
              fixturesHoje = await syncFixtures("hoje");
            } else {
              skipped.API_FOOTBALL_KEY = "controle de intervalo indisponível";
            }
          } else {
            skipped.API_FOOTBALL_KEY = `dentro do intervalo de ${Math.round(footballSync.intervaloMin)} min`;
          }

          // API 2: The Odds API — odds + deep links das ligas com jogos.
          let result = { ligas: 0, chamadas: 0, eventos: 0, odds: 0 };
          if (oddsApiSync.ok) {
            if (await reservarSync(supabaseAdmin, "odds_api", now)) {
              result = await syncOddsFromOddsApi(casa);
            } else {
              skipped.ODDS_API_KEY = "controle de intervalo indisponível";
            }
          } else {
            skipped.ODDS_API_KEY = `dentro do intervalo de ${Math.round(oddsApiSync.intervaloMin)} min`;
          }

          return Response.json({ ok: true, casa, skipped, fixturesHoje, ...result });
        } catch (e) {
          console.error("Erro no robô diário de odds:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
