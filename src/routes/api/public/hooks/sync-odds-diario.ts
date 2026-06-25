import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOddsFromOddsApi } from "@/lib/football.server";

// Robô diário (1x por dia):
// API 1 (API-Football) atualiza as partidas/ligas do dia.
// API 2 (The Odds API) coleta as odds + deep links das casas.
const CASA_PADRAO = "betano";

export const Route = createFileRoute("/api/public/hooks/sync-odds-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const casa = url.searchParams.get("casa") ?? CASA_PADRAO;

          // API 1: garante as partidas do dia (descobre as ligas com jogos).
          const fixturesHoje = await syncFixtures("hoje");

          // API 2: The Odds API — odds + deep links das ligas com jogos.
          const result = await syncOddsFromOddsApi(casa);

          return Response.json({ ok: true, casa, fixturesHoje, ...result });
        } catch (e) {
          console.error("Erro no robô diário de odds:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
