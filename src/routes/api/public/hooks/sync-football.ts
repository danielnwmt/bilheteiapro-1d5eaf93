import { createFileRoute } from "@tanstack/react-router";
import { hasApiFootballKey, MISSING_API_FOOTBALL_KEY, syncFixtures, syncOddsByLeagueDias } from "@/lib/football.server";
import { verificarCronSecret } from "@/lib/cron-auth";


// Janela (min) para considerar um jogo "acontecendo agora" mesmo sem status ao_vivo.
const LIVE_WINDOW_MIN = 150; // ~2h30 de duração de jogo
const CASA_PADRAO = "betano";

// Ritmo rápido (a cada 4 min): só o essencial — jogos ao vivo e odds de HOJE.
const INTERVALO_RAPIDO_MIN = 4;
// Ritmo lento (a cada 60 min): semana inteira (jogos + odds dos próximos dias).
// Odds de jogos daqui a vários dias quase não mudam; puxá-las a cada 4 min
// multiplica as chamadas e estoura o limite da API.
const INTERVALO_SEMANA_MIN = 60;

async function podeSincronizar(
  supabaseAdmin: any,
  id: string,
  intervaloMin: number,
  now: number,
) {
  const { data: state, error } = await supabaseAdmin
    .from("sync_state")
    .select("last_sync_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`sync_state ${id} indisponível; bloqueando chamada da API`, error);
    return { ok: false, intervaloMin, minutesSinceLast: 0 };
  }

  const last = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : 0;
  const minutesSinceLast = (now - last) / 60_000;
  return { ok: minutesSinceLast >= intervaloMin, intervaloMin, minutesSinceLast };
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
      POST: async ({ request }) => {
        const unauthorized = verificarCronSecret(request);
        if (unauthorized) return unauthorized;

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

        const rapidoSync = await podeSincronizar(supabaseAdmin, "football", INTERVALO_RAPIDO_MIN, now);
        const semanaSync = await podeSincronizar(supabaseAdmin, "football_semana", INTERVALO_SEMANA_MIN, now);

        try {
          // Ritmo LENTO (1x/hora): semana inteira de jogos + odds dos próximos dias.
          if (semanaSync.ok) {
            if (await reservarSync(supabaseAdmin, "football_semana", now)) {
              fixturesHoje = await syncFixtures("semana");
              const result = await syncOddsByLeagueDias(CASA_PADRAO, 8);
              oddsCount = result.odds;
            } else {
              skipped.semana = "controle de intervalo indisponível";
            }
          } else {
            skipped.semana = `dentro do intervalo de ${Math.round(semanaSync.intervaloMin)} min`;
          }

          // Ritmo RÁPIDO (a cada 4 min): só jogos ao vivo + odds de HOJE.
          if (rapidoSync.ok) {
            if (await reservarSync(supabaseAdmin, "football", now)) {
              if (hasLive) {
                fixturesAoVivo = await syncFixtures("aovivo");
              }
              const result = await syncOddsByLeagueDias(CASA_PADRAO, 1);
              oddsCount += result.odds;
            } else {
              skipped.rapido = "controle de intervalo indisponível";
            }
          } else {
            skipped.rapido = `dentro do intervalo de ${Math.round(rapidoSync.intervaloMin)} min`;
          }
        } catch (e) {
          const msg = String(e);
          // Chave da API-Football não configurada: não é falha do robô — apenas
          // avisa (evita erro 500 repetido no cron a cada 7 min).
          if (msg.includes(MISSING_API_FOOTBALL_KEY)) {
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
          console.error("Erro no sync agendado:", e);
          return Response.json(
            { ok: false, error: msg },
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
