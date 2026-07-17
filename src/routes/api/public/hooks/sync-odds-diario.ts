import { createFileRoute } from "@tanstack/react-router";
import {
  DAILY_LIMIT_REACHED,
  hasApiFootballKey,
  INVALID_API_FOOTBALL_KEY,
  MISSING_API_FOOTBALL_KEY,
  syncFixturesSemanaIncremental,
  syncOddsByLeagueDias,
} from "@/lib/football.server";
import { verificarCronSecret } from "@/lib/cron-auth";
import { acquireSyncLock, releaseSyncLock, type SyncLock } from "@/lib/sync-lock.server";

// Robô diário (1x por dia):
// API-Football atualiza as partidas/ligas do dia E coleta as odds.
const CASA_PADRAO = "Bet365";
// Compartilha a mesma janela semanal do robô principal (1x/hora) usando a
// chave "football_semana". Assim os dois crons não puxam a semana em duplicidade.
const INTERVALO_SEMANA_MIN = 60;

export const Route = createFileRoute("/api/public/hooks/sync-odds-diario")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verificarCronSecret(request);
        if (unauthorized) return unauthorized;
        const reservados: SyncLock[] = [];
        let supabaseAdmin: any = null;
        try {
          ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
          const url = new URL(request.url);
          const casa = url.searchParams.get("casa") ?? CASA_PADRAO;
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
          const footballLock = await acquireSyncLock(supabaseAdmin, "football_semana", {
            intervalMinutes: INTERVALO_SEMANA_MIN,
            ttlSeconds: 20 * 60,
          });
          if (footballLock) {
            reservados.push(footballLock);
            // Garante as partidas da SEMANA inteira (hoje + próximos 7 dias)
            // e coleta as odds de todos esses dias.
            fixturesHoje = await syncFixturesSemanaIncremental();
            result = await syncOddsByLeagueDias(casa, 8, {
              maxLigas: 2,
              cursorKey: "odds_cursor_diario",
            });
          } else {
            skipped.API_FOOTBALL_KEY = `outra execução ativa ou dentro do intervalo de ${INTERVALO_SEMANA_MIN} min`;
          }

          await Promise.all(reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, true)));
          return Response.json({ ok: true, casa, skipped, fixturesHoje, ...result });
        } catch (e) {
          const msg = String(e);
          if (msg.includes(MISSING_API_FOOTBALL_KEY)) {
            if (supabaseAdmin)
              await Promise.all(
                reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
              );
            return Response.json({
              ok: true,
              skipped: { API_FOOTBALL_KEY: "chave não configurada em Configurações → APIs" },
              requiresConfig: true,
            });
          }
          if (msg.includes(INVALID_API_FOOTBALL_KEY)) {
            if (supabaseAdmin)
              await Promise.all(
                reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
              );
            return Response.json({
              ok: true,
              skipped: { API_FOOTBALL_KEY: "chave rejeitada pela API-Football" },
              invalidKey: true,
            });
          }
          if (msg.includes(DAILY_LIMIT_REACHED)) {
            if (supabaseAdmin) {
              await Promise.all(
                reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
              );
            }
            return Response.json({
              ok: true,
              skipped: { API_FOOTBALL_KEY: "limite diário da API-Football atingido" },
              dailyLimit: true,
            });
          }
          if (supabaseAdmin)
            await Promise.all(
              reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
            );
          console.error("Erro no robô diário de odds:", e);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
