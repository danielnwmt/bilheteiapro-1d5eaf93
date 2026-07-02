// Estatísticas AO VIVO de um jogo (placar, minuto e métricas em tempo real).
// A UI chama esta função e a atualiza periodicamente enquanto o jogo acontece.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { EstatAoVivo } from "@/lib/football.server";

const InputSchema = z.object({ partidaId: z.string().uuid() });

export type { EstatAoVivo } from "@/lib/football.server";

export const getEstatisticasAoVivoPartida = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ ok: boolean; motivo?: string; stats?: EstatAoVivo }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hasApiFootballKey, getEstatisticasAoVivo } = await import("@/lib/football.server");

    if (!(await hasApiFootballKey())) {
      return { ok: false, motivo: "Chave da API de futebol não configurada." };
    }

    const { data: partida } = await supabaseAdmin
      .from("partidas")
      .select("external_id")
      .eq("id", data.partidaId)
      .maybeSingle();

    const externalId = (partida as { external_id: string | null } | null)?.external_id;
    if (!externalId) {
      return { ok: false, motivo: "Jogo sem identificador para dados ao vivo." };
    }

    try {
      const stats = await getEstatisticasAoVivo(externalId);
      return { ok: true, stats };
    } catch (e) {
      console.error("getEstatisticasAoVivoPartida", e);
      return { ok: false, motivo: "Não foi possível carregar os dados ao vivo agora." };
    }
  });
