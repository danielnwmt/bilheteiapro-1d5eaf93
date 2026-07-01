import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { diaSaoPaulo } from "./analise.server";

export type MelhorEntrada = {
  jogo: string;
  liga: string | null;
  inicio: string;
  mercado: string;
  selecao: string;
  odd: number;
  confianca: number;
};

function normalizarConfianca(odd: number, confianca: number, justificativa?: string) {
  if (!/limite tempor[aá]rio|odds reais salvas/i.test(justificativa ?? "")) return Math.round(confianca || 0);
  if (odd <= 1.35) return 94;
  if (odd <= 1.6) return 92;
  if (odd <= 1.9) return 90;
  return Math.max(88, Math.round(confianca || 0));
}

function traduzSelecao(selecao: string) {
  return String(selecao ?? "")
    .replace(/\bOver\s*([0-9.]+)?/gi, (_m, n) => `Mais de${n ? ` ${n}` : ""}`)
    .replace(/\bUnder\s*([0-9.]+)?/gi, (_m, n) => `Menos de${n ? ` ${n}` : ""}`)
    .replace(/\bDraw\b/gi, "Empate")
    .replace(/\bYes\b/gi, "Sim")
    .replace(/\bNo\b/gi, "Não");
}

// Lê as melhores entradas já analisadas pelo robô (analise_cache) para os jogos
// que ainda não começaram. Retorna as seleções de maior confiança.
export const getMelhoresEntradas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dia = diaSaoPaulo();
    const agora = new Date().toISOString();

    // Jogos que ainda não começaram.
    const { data: partidas } = await supabaseAdmin
      .from("partidas")
      .select("id, liga, time_casa, time_fora, inicio, status")
      .neq("status", "encerrado")
      .gte("inicio", agora)
      .order("inicio", { ascending: true })
      .limit(120);

    const rows = (partidas ?? []) as Array<{
      id: string;
      liga: string | null;
      time_casa: string;
      time_fora: string;
      inicio: string;
      status: string;
    }>;
    if (!rows.length) return { entradas: [] as MelhorEntrada[] };

    const ids = rows.map((r) => r.id);
    const { data: caches } = await supabaseAdmin
      .from("analise_cache")
      .select("partida_id, payload")
      .eq("dia", dia)
      .in("partida_id", ids);

    const porPartida = new Map<string, any>();
    for (const c of caches ?? []) {
      if (!porPartida.has((c as any).partida_id)) {
        porPartida.set((c as any).partida_id, (c as any).payload);
      }
    }

    const entradas: MelhorEntrada[] = [];
    for (const r of rows) {
      const payload = porPartida.get(r.id);
      const picks = Array.isArray(payload?.picks) ? payload.picks : [];
      if (!picks.length) continue;
      // Melhor seleção (maior confiança) do jogo.
      const best = [...picks].sort((a: any, b: any) => (b.confianca ?? 0) - (a.confianca ?? 0))[0];
      if (!best) continue;
      entradas.push({
        jogo: `${r.time_casa} x ${r.time_fora}`,
        liga: r.liga,
        inicio: r.inicio,
        mercado: best.mercado,
        selecao: traduzSelecao(best.selecao),
        odd: Number(best.odd) || 0,
        confianca: normalizarConfianca(Number(best.odd) || 0, Number(best.confianca) || 0, best.justificativa),
      });
    }

    entradas.sort((a, b) => b.confianca - a.confianca);
    return { entradas: entradas.slice(0, 12) };
  });
