import { createFileRoute } from "@tanstack/react-router";
import { hasApiFootballKey, MISSING_API_FOOTBALL_KEY, syncFixtures, syncOddsByLeagueToday } from "@/lib/football.server";


// Robô diário (1x por dia):
// API-Football atualiza as partidas/ligas do dia E coleta as odds.
const CASA_PADRAO = "betano";
// Intervalo fixo de execução: a cada 7 minutos.
const INTERVALO_FIXO_MIN = 7;

async function getIntervaloMin(_chave: string): Promise<number> {
  return INTERVALO_FIXO_MIN;
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
          const skipped: Record<string, string> = {};

          if (!(await hasApiFootballKey())) {
            return Response.json({
              ok: true,
              casa,
              skipped: { API_FOOTBALL_KEY: "chave não configurada em Configurações → APIs" },
              requiresConfig: true,
              fixturesHoje: 0,
              ligas: 0,
              chamadas: 0,
              odds: 0,
            });
          }

          // API-Football: garante as partidas do dia E coleta as odds por liga.
          let fixturesHoje = 0;
          let result = { ligas: 0, chamadas: 0, odds: 0 };
          if (footballSync.ok) {
            if (await reservarSync(supabaseAdmin, "football", now)) {
              fixturesHoje = await syncFixtures("hoje");
              result = await syncOddsByLeagueToday(casa);
            } else {
              skipped.API_FOOTBALL_KEY = "controle de intervalo indisponível";
            }
          } else {
            skipped.API_FOOTBALL_KEY = `dentro do intervalo de ${Math.round(footballSync.intervaloMin)} min`;
          }

          return Response.json({ ok: true, casa, skipped, fixturesHoje, ...result });
        } catch (e) {
          const msg = String(e);
          if (msg.includes(MISSING_API_FOOTBALL_KEY)) {
            return Response.json({
              ok: true,
              skipped: { API_FOOTBALL_KEY: "chave não configurada em Configurações → APIs" },
              requiresConfig: true,
            });
          }
          console.error("Erro no robô diário de odds:", e);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
