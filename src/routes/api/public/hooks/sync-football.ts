import { createFileRoute } from "@tanstack/react-router";
import {
  DAILY_LIMIT_REACHED,
  hasApiFootballKey,
  INVALID_API_FOOTBALL_KEY,
  MISSING_API_FOOTBALL_KEY,
  syncFixtures,
  syncFixturesSemanaIncremental,
  syncOddsByLeagueDias,
} from "@/lib/football.server";
import { verificarCronSecret } from "@/lib/cron-auth";
import { acquireSyncLock, releaseSyncLock, type SyncLock } from "@/lib/sync-lock.server";

// Janela (min) para considerar um jogo "acontecendo agora" mesmo sem status ao_vivo.
const LIVE_WINDOW_MIN = 150; // ~2h30 de duração de jogo
const CASA_PADRAO = "Bet365";

// Ritmo rápido (a cada 4 min): só o essencial — jogos ao vivo e odds de HOJE.
const INTERVALO_RAPIDO_MIN = 5;
// Ritmo lento (a cada 60 min): semana inteira (jogos + odds dos próximos dias).
// Odds de jogos daqui a vários dias quase não mudam; puxá-las a cada 4 min
// multiplica as chamadas e estoura o limite da API.
const INTERVALO_SEMANA_MIN = 60;

export const Route = createFileRoute("/api/public/hooks/sync-football")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verificarCronSecret(request);
        if (unauthorized) return unauthorized;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = Date.now();
        const liveFrom = new Date(now - LIVE_WINDOW_MIN * 60_000).toISOString();
        const liveTo = new Date(now).toISOString();

        // Existe jogo acontecendo agora? (ao vivo OU iniciado dentro da janela)
        const { count: liveCount } = await supabaseAdmin
          .from("partidas")
          .select("id", { count: "exact", head: true })
          .or(
            `and(status.eq.ao_vivo,inicio.gte.${liveFrom},inicio.lte.${liveTo}),and(inicio.gte.${liveFrom},inicio.lte.${liveTo})`,
          );

        const hasLive = (liveCount ?? 0) > 0;

        let fixturesAoVivo = 0;
        let fixturesHoje = 0;
        let oddsCount = 0;
        const skipped: Record<string, string> = {};
        const reservados: SyncLock[] = [];

        if (!(await hasApiFootballKey())) {
          return Response.json({
            ok: true,
            hasLive,
            skipped: { API_FOOTBALL_KEY: "chave não configurada em Configurações → APIs" },
            requiresConfig: true,
            fixturesHoje,
            fixturesAoVivo,
            oddsCount,
          });
        }

        try {
          // Ritmo LENTO (1x/hora): semana inteira de jogos + odds dos próximos dias.
          const semanaLock = await acquireSyncLock(supabaseAdmin, "football_semana", {
            intervalMinutes: INTERVALO_SEMANA_MIN,
            ttlSeconds: 20 * 60,
          });
          if (semanaLock) {
            reservados.push(semanaLock);
            fixturesHoje = await syncFixturesSemanaIncremental();
            const result = await syncOddsByLeagueDias(CASA_PADRAO, 8, {
              maxLigas: 2,
              cursorKey: "odds_cursor_semana",
            });
            oddsCount = result.odds;
          } else {
            skipped.semana = `outra execução ativa ou dentro do intervalo de ${INTERVALO_SEMANA_MIN} min`;
          }

          // Ritmo RÁPIDO (a cada 4 min): só jogos ao vivo + odds de HOJE.
          const rapidoLock = await acquireSyncLock(supabaseAdmin, "football", {
            intervalMinutes: INTERVALO_RAPIDO_MIN,
            ttlSeconds: 8 * 60,
          });
          if (rapidoLock) {
            reservados.push(rapidoLock);
            if (hasLive) {
              fixturesAoVivo = await syncFixtures("aovivo");
            }
            const result = await syncOddsByLeagueDias(CASA_PADRAO, 1, {
              maxLigas: 2,
              cursorKey: "odds_cursor_hoje",
            });
            oddsCount += result.odds;
          } else {
            skipped.rapido = `outra execução ativa ou dentro do intervalo de ${INTERVALO_RAPIDO_MIN} min`;
          }
        } catch (e) {
          const msg = String(e);
          // Chave da API-Football não configurada: não é falha do robô — apenas
          // avisa (evita erro 500 repetido no cron a cada 7 min).
          if (msg.includes(MISSING_API_FOOTBALL_KEY)) {
            await Promise.all(
              reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
            );
            return Response.json({
              ok: true,
              hasLive,
              skipped: { API_FOOTBALL_KEY: "chave não configurada em Configurações → APIs" },
              requiresConfig: true,
              fixturesHoje,
              fixturesAoVivo,
              oddsCount,
            });
          }
          if (msg.includes(INVALID_API_FOOTBALL_KEY)) {
            await Promise.all(
              reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
            );
            return Response.json({
              ok: true,
              hasLive,
              skipped: { API_FOOTBALL_KEY: "chave rejeitada pela API-Football" },
              invalidKey: true,
              fixturesHoje,
              fixturesAoVivo,
              oddsCount,
            });
          }
          // Limite DIÁRIO da API-Football: não é erro do robô — apenas acabou a
          // cota do dia. Evita 500 repetido no cron até o limite resetar.
          if (msg.includes(DAILY_LIMIT_REACHED)) {
            if (supabaseAdmin) {
              await Promise.all(
                reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
              );
            }
            return Response.json({
              ok: true,
              hasLive,
              skipped: { API_FOOTBALL_KEY: "limite diário da API-Football atingido" },
              dailyLimit: true,
              fixturesHoje,
              fixturesAoVivo,
              oddsCount,
            });
          }
          await Promise.all(
            reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, false, msg)),
          );
          console.error("Erro no sync agendado:", e);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }

        await Promise.all(reservados.map((lock) => releaseSyncLock(supabaseAdmin, lock, true)));
        return Response.json({
          ok: true,
          hasLive,
          skipped,
          fixturesHoje,
          fixturesAoVivo,
          oddsCount,
        });
      },
    },
  },
});
