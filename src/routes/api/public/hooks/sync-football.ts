import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOdds } from "@/lib/football.server";

// Janela (min) para considerar um jogo "acontecendo agora" mesmo sem status ao_vivo.
const LIVE_WINDOW_MIN = 150; // ~2h30 de duração de jogo
const IDLE_INTERVAL_MIN = 60; // sem jogos: sincroniza no máximo a cada 1h
const CASA_PADRAO = "betano";

export const Route = createFileRoute("/api/public/hooks/sync-football")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const now = Date.now();
        const liveFrom = new Date(now - LIVE_WINDOW_MIN * 60_000).toISOString();
        const liveTo = new Date(now).toISOString();

        // Existe jogo acontecendo agora? (ao vivo OU iniciado dentro da janela)
        const { count: liveCount } = await supabaseAdmin
          .from("partidas")
          .select("id", { count: "exact", head: true })
          .or(`status.eq.ao_vivo,and(inicio.gte.${liveFrom},inicio.lte.${liveTo})`);

        const hasLive = (liveCount ?? 0) > 0;

        // Último sync registrado
        const { data: state } = await supabaseAdmin
          .from("sync_state")
          .select("last_sync_at")
          .eq("id", "football")
          .maybeSingle();

        const last = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : 0;
        const minutesSinceLast = (now - last) / 60_000;

        // Com jogos ao vivo: sincroniza sempre (cron roda a cada 15 min).
        // Sem jogos: só sincroniza se passou ao menos 1h do último sync.
        const shouldSync = hasLive || minutesSinceLast >= IDLE_INTERVAL_MIN;

        if (!shouldSync) {
          return Response.json({
            ok: true,
            skipped: true,
            reason: "sem jogos ao vivo e dentro da janela de 1h",
            minutesSinceLast: Math.round(minutesSinceLast),
          });
        }

        let fixturesAoVivo = 0;
        let fixturesHoje = 0;
        let oddsCount = 0;

        try {
          fixturesHoje = await syncFixtures("hoje");
          if (hasLive) {
            fixturesAoVivo = await syncFixtures("aovivo");

            // Atualiza odds reais das partidas ao vivo / em andamento.
            const { data: partidas } = await supabaseAdmin
              .from("partidas")
              .select("id, external_id, time_casa, time_fora")
              .or(
                `status.eq.ao_vivo,and(inicio.gte.${liveFrom},inicio.lte.${liveTo})`,
              )
              .not("external_id", "is", null)
              .limit(12);

            if (partidas?.length) {
              oddsCount = await syncOdds(partidas, CASA_PADRAO);
            }
          }
        } catch (e) {
          console.error("Erro no sync agendado:", e);
          return Response.json(
            { ok: false, error: String(e) },
            { status: 500 },
          );
        }

        await supabaseAdmin
          .from("sync_state")
          .upsert(
            { id: "football", last_sync_at: new Date(now).toISOString() },
            { onConflict: "id" },
          );

        return Response.json({
          ok: true,
          hasLive,
          fixturesHoje,
          fixturesAoVivo,
          oddsCount,
        });
      },
    },
  },
});
