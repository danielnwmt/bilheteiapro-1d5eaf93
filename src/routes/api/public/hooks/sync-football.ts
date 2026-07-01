import { createFileRoute } from "@tanstack/react-router";
import { syncFixtures, syncOdds, syncOddsFromOddsApi } from "@/lib/football.server";
import { getConfigKey, getApiFlow } from "@/lib/system-config.server";

// Janela (min) para considerar um jogo "acontecendo agora" mesmo sem status ao_vivo.
const LIVE_WINDOW_MIN = 150; // ~2h30 de duração de jogo
const CASA_PADRAO = "betano";

// Intervalo fixo de execução para todas as APIs: a cada 7 minutos.
const INTERVALO_FIXO_MIN = 7;

async function getIntervaloMin(_chave: string): Promise<number> {
  return INTERVALO_FIXO_MIN;
}

async function podeSincronizar(
  supabaseAdmin: any,
  id: string,
  chave: string,
  now: number,
) {
  const { data: state, error } = await supabaseAdmin
    .from("sync_state")
    .select("last_sync_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`sync_state ${id} indisponível; bloqueando chamada da API`, error);
    return {
      ok: false,
      intervaloMin: await getIntervaloMin(chave),
      minutesSinceLast: 0,
    };
  }

  const last = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : 0;
  const minutesSinceLast = (now - last) / 60_000;
  const intervaloMin = await getIntervaloMin(chave);
  return {
    ok: minutesSinceLast >= intervaloMin,
    intervaloMin,
    minutesSinceLast,
  };
}

async function reservarSync(supabaseAdmin: any, id: string, now: number): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("sync_state")
    .upsert(
      { id, last_sync_at: new Date(now).toISOString() },
      { onConflict: "id" },
    );
  if (error) {
    console.error(`Não foi possível gravar sync_state ${id}; chamada da API bloqueada`, error);
    return false;
  }
  return true;
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

        let fixturesAoVivo = 0;
        let fixturesHoje = 0;
        let oddsCount = 0;
        const skipped: Record<string, string> = {};

        // Fluxo configurado no painel: qual API faz cada etapa.
        const flow = await getApiFlow();
        const footballSync = await podeSincronizar(supabaseAdmin, "football", "API_FOOTBALL_KEY", now);
        const oddsApiSync = await podeSincronizar(supabaseAdmin, "odds_api", "ODDS_API_KEY", now);
        let footballReservado = false;

        try {
          // Etapa "jogos": só chama API-Football quando passou o intervalo dela.
          if (footballSync.ok) {
            footballReservado = await reservarSync(supabaseAdmin, "football", now);
            if (footballReservado) {
              fixturesHoje = await syncFixtures("hoje");
              if (hasLive) {
                fixturesAoVivo = await syncFixtures("aovivo");
              }
            } else {
              skipped.API_FOOTBALL_KEY = "controle de intervalo indisponível";
            }
          } else {
            skipped.API_FOOTBALL_KEY = `dentro do intervalo de ${Math.round(footballSync.intervaloMin)} min`;
          }

          // Etapa "odds": usa a API definida no fluxo e respeita o intervalo da chave escolhida.
          if (flow.odds === "ODDS_API_KEY") {
            if (oddsApiSync.ok) {
              if (await reservarSync(supabaseAdmin, "odds_api", now)) {
                // The Odds API: já traz odds + deep links das casas.
                const r = await syncOddsFromOddsApi(CASA_PADRAO);
                oddsCount = r.odds;
              } else {
                skipped.ODDS_API_KEY = "controle de intervalo indisponível";
              }
            } else {
              skipped.ODDS_API_KEY = `dentro do intervalo de ${Math.round(oddsApiSync.intervaloMin)} min`;
            }
          } else {
            if (footballReservado) {
              // API-Football (padrão). Cobre jogos ao vivo e os próximos de hoje.
              const todayTo = new Date(now + 24 * 60 * 60_000).toISOString();
              const { data: partidas } = await supabaseAdmin
                .from("partidas")
                .select("id, external_id, time_casa, time_fora")
                .or(
                  `status.eq.ao_vivo,and(inicio.gte.${liveFrom},inicio.lte.${todayTo})`,
                )
                .not("external_id", "is", null)
                .limit(20);

              if (partidas?.length) {
                oddsCount = await syncOdds(partidas, CASA_PADRAO);
              }
            } else if (footballSync.ok) {
              skipped.API_FOOTBALL_KEY = "controle de intervalo indisponível";
            }
          }
        } catch (e) {
          console.error("Erro no sync agendado:", e);
          return Response.json(
            { ok: false, error: String(e) },
            { status: 500 },
          );
        }

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
