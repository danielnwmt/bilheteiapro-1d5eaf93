import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOdds } from "@/lib/football.server";
import { getConfigKey } from "@/lib/system-config.server";

// Janela (min) para considerar um jogo "acontecendo agora" mesmo sem status ao_vivo.
const LIVE_WINDOW_MIN = 150; // ~2h30 de duração de jogo
const IDLE_INTERVAL_MIN_DEFAULT = 60; // fallback: sem intervalo configurado
const CASA_PADRAO = "betano";

// Lê o intervalo configurado no painel (chave API_FOOTBALL_KEY) em minutos.
async function getIntervaloMin(): Promise<number> {
  const valorRaw = await getConfigKey("API_FOOTBALL_KEY_INTERVALO_VALOR");
  const unidade = (await getConfigKey("API_FOOTBALL_KEY_INTERVALO_UNIDADE")) ?? "minutos";
  const valor = Number(valorRaw);
  if (!valor || valor <= 0) return IDLE_INTERVAL_MIN_DEFAULT;
  if (unidade === "segundos") return valor / 60;
  if (unidade === "horas") return valor * 60;
  return valor; // minutos
}


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

        // Só sincroniza quando passou o intervalo configurado na chave,
        // mesmo que existam jogos ao vivo.
        const intervaloMin = await getIntervaloMin();
        const shouldSync = minutesSinceLast >= intervaloMin;

        if (!shouldSync) {
          return Response.json({
            ok: true,
            skipped: true,
            reason: `sem jogos ao vivo e dentro do intervalo de ${Math.round(intervaloMin)} min`,
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
