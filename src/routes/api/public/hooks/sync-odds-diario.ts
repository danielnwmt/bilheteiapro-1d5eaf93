import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOddsByLeagueToday } from "@/lib/football.server";

// Robô diário de odds: garante as partidas de hoje e coleta as odds
// disponíveis fazendo apenas UMA chamada por liga com jogos no dia.
const CASA_PADRAO = "betano";

export const Route = createFileRoute("/api/public/hooks/sync-odds-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Permite escolher a casa via ?casa=... (default: betano).
          const url = new URL(request.url);
          const casa = url.searchParams.get("casa") ?? CASA_PADRAO;

          // 1. Atualiza as partidas do dia (descobre as ligas com jogos).
          const fixturesHoje = await syncFixtures("hoje");

          // 2. Coleta odds: 1 chamada por liga com jogos hoje.
          const result = await syncOddsByLeagueToday(casa);

          return Response.json({ ok: true, casa, fixturesHoje, ...result });
        } catch (e) {
          console.error("Erro no robô diário de odds:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
