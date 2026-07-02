// Reanálise sob demanda de UM jogo (usado quando a escalação é confirmada).
// Limpa o cache de análise daquele jogo e força a IA a reanalisar com os dados
// mais recentes. Restrito a staff (admin/operador) para evitar abuso da IA.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PartidaRow } from "@/lib/analise.server";

const InputSchema = z.object({ partidaId: z.string().uuid() });

const APP_CASAS = ["Bet365", "Betano", "Superbet", "KTO", "Sportingbet", "Betfair"];

function normKey(v: string) {
  return v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const reanalisarJogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Só staff pode disparar reanálise.
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r) => r.role);
    if (!roles.includes("admin") && !roles.includes("operador")) {
      throw new Error("Apenas administradores podem forçar a reanálise.");
    }

    const { obterAnalisePartida, diaSaoPaulo } = await import("@/lib/analise.server");
    const { hasApiFootballKey, syncEstatisticas } = await import("@/lib/football.server");

    const dia = diaSaoPaulo(new Date());

    // 1) Limpa o cache de análise do jogo (todas as casas) para o dia.
    await supabaseAdmin.from("analise_cache").delete().eq("partida_id", data.partidaId).eq("dia", dia);

    // 2) Lê o jogo com odds.
    const { data: partida, error } = await supabaseAdmin
      .from("partidas")
      .select("id, external_id, liga, time_casa, time_fora, inicio, status, arbitro, odds(casa, mercado, selecao, valor, external_odd_id)")
      .eq("id", data.partidaId)
      .maybeSingle();
    if (error || !partida) throw new Error("Jogo não encontrado.");

    const row = partida as unknown as PartidaRow;
    if (!row.odds?.length) {
      return { ok: false, reanalisado: false, motivo: "Jogo ainda sem odds salvas." };
    }

    // 3) Atualiza estatísticas reais (escalação confirmada muda as métricas).
    if (row.external_id && (await hasApiFootballKey())) {
      try {
        await syncEstatisticas([{ id: row.id, external_id: row.external_id, time_casa: row.time_casa, time_fora: row.time_fora }]);
      } catch (e) {
        console.error("reanalisarJogo: falha ao atualizar estatísticas", e);
      }
    }
    const { data: statsRow } = await supabaseAdmin
      .from("estatisticas")
      .select("payload")
      .eq("partida_id", row.id)
      .eq("tipo", "predicoes")
      .maybeSingle();
    row.estatisticas = (statsRow?.payload ?? null) as never;

    // 4) Escolhe a casa com odds e reanalisa 100% localmente (sem IA).
    let casa = APP_CASAS.find((c) => row.odds.some((o) => normKey(o.casa) === normKey(c)));
    if (!casa) casa = row.odds[0].casa;

    const analise = await obterAnalisePartida(supabaseAdmin, null, row, casa, dia, false);

    return { ok: true, reanalisado: analise.picks.length > 0, picks: analise.picks.length };
  });
