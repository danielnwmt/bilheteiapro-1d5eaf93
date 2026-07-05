// Histórico de bilhetes do cliente.
// -----------------------------------------------------------------------------
// CRUD sobre `public.historico_bilhetes`. 100% aditivo — não altera bilhetes,
// banca nem o motor de análise. Cada registro guarda os jogos, mercados, odds,
// stake, retorno e resultado (green/red/void/pendente) de um bilhete.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertPlanoAtivo, dataMinimaHistorico } from "./plan-gates.server";

export type ResultadoHistorico = "pendente" | "green" | "red" | "void";

export type PickHistorico = { jogo: string; mercado: string; selecao: string; odd: number };

export type HistoricoBilhete = {
  id: string;
  data_evento: string;
  jogos: string;
  mercados: string;
  odds_detalhe: PickHistorico[];
  odd_total: number;
  tipo: string;
  casa: string | null;
  stake: number;
  retorno: number;
  resultado: ResultadoHistorico;
  observacoes: string | null;
  bilhete_id: string | null;
  created_at: string;
};

type NovoHistorico = {
  data_evento?: string;
  jogos: string;
  mercados: string;
  odds_detalhe?: PickHistorico[];
  odd_total: number;
  tipo?: string;
  casa?: string | null;
  stake?: number;
  resultado?: ResultadoHistorico;
  observacoes?: string | null;
  bilhete_id?: string | null;
};

const num = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

function mapRow(r: any): HistoricoBilhete {
  return {
    id: r.id,
    data_evento: r.data_evento,
    jogos: r.jogos ?? "",
    mercados: r.mercados ?? "",
    odds_detalhe: Array.isArray(r.odds_detalhe) ? (r.odds_detalhe as PickHistorico[]) : [],
    odd_total: num(r.odd_total, 1),
    tipo: r.tipo ?? "padrao",
    casa: r.casa ?? null,
    stake: num(r.stake),
    retorno: num(r.retorno),
    resultado: (r.resultado ?? "pendente") as ResultadoHistorico,
    observacoes: r.observacoes ?? null,
    bilhete_id: r.bilhete_id ?? null,
    created_at: r.created_at,
  };
}

/** Lista o histórico do usuário (mais recentes primeiro). */
export const listHistorico = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HistoricoBilhete[]> => {
    const { supabase, userId, claims } = context;
    const access = await assertPlanoAtivo(supabase, userId, claims);
    const dataMinima = dataMinimaHistorico(access);
    let q = supabase.from("historico_bilhetes").select("*").eq("user_id", userId);
    if (dataMinima) q = q.gte("data_evento", dataMinima);
    const { data, error } = await q
      .order("data_evento", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRow);
  });

/** Registra um novo bilhete no histórico. */
export const addHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: NovoHistorico) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertPlanoAtivo(supabase, userId, claims);
    const stake = num(data.stake);
    const oddTotal = num(data.odd_total, 1);
    const resultado = data.resultado ?? "pendente";
    // Retorno calculado automaticamente pelo resultado (pode ser editado depois).
    const retorno = resultado === "green" ? stake * oddTotal : resultado === "void" ? stake : 0;
    const { data: row, error } = await supabase
      .from("historico_bilhetes")
      .insert({
        user_id: userId,
        data_evento: data.data_evento || undefined,
        jogos: data.jogos ?? "",
        mercados: data.mercados ?? "",
        odds_detalhe: data.odds_detalhe ?? [],
        odd_total: oddTotal,
        tipo: data.tipo ?? "padrao",
        casa: data.casa ?? null,
        stake,
        retorno,
        resultado,
        observacoes: data.observacoes ?? null,
        bilhete_id: data.bilhete_id ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row);
  });

/** Atualiza resultado/stake/observações de um item do histórico. */
export const updateHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      resultado?: ResultadoHistorico;
      stake?: number;
      retorno?: number;
      observacoes?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const access = await assertPlanoAtivo(supabase, userId, claims);
    const dataMinima = dataMinimaHistorico(access);
    const patch: Record<string, unknown> = {};
    if (data.stake !== undefined) patch.stake = num(data.stake);
    if (data.observacoes !== undefined) patch.observacoes = data.observacoes;

    if (data.resultado !== undefined) {
      patch.resultado = data.resultado;
      // Recalcula retorno automaticamente ao mudar o resultado, exceto se o
      // chamador enviar um retorno explícito.
      const { data: atual } = await supabase
        .from("historico_bilhetes")
        .select("stake, odd_total, data_evento")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (dataMinima && atual?.data_evento && atual.data_evento < dataMinima)
        throw new Error(
          "Seu plano não permite alterar itens fora do período de histórico liberado.",
        );
      const stake = num(data.stake ?? atual?.stake);
      const oddTotal = num(atual?.odd_total, 1);
      patch.retorno =
        data.retorno !== undefined
          ? num(data.retorno)
          : data.resultado === "green"
            ? stake * oddTotal
            : data.resultado === "void"
              ? stake
              : 0;
    } else if (data.retorno !== undefined) {
      patch.retorno = num(data.retorno);
    }

    let q = supabase
      .from("historico_bilhetes")
      .update(patch as never)
      .eq("id", data.id)
      .eq("user_id", userId);
    if (dataMinima) q = q.gte("data_evento", dataMinima);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Remove um item do histórico. */
export const deleteHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const access = await assertPlanoAtivo(supabase, userId, claims);
    const dataMinima = dataMinimaHistorico(access);
    let q = supabase.from("historico_bilhetes").delete().eq("id", data.id).eq("user_id", userId);
    if (dataMinima) q = q.gte("data_evento", dataMinima);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Duplica um bilhete existente do histórico (novo registro pendente). */
export const duplicarHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const access = await assertPlanoAtivo(supabase, userId, claims);
    const dataMinima = dataMinimaHistorico(access);
    let origemQuery = supabase
      .from("historico_bilhetes")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId);
    if (dataMinima) origemQuery = origemQuery.gte("data_evento", dataMinima);
    const { data: orig, error: e1 } = await origemQuery.single();
    if (e1) throw new Error(e1.message);
    const { data: row, error } = await supabase
      .from("historico_bilhetes")
      .insert({
        user_id: userId,
        jogos: orig.jogos,
        mercados: orig.mercados,
        odds_detalhe: orig.odds_detalhe,
        odd_total: orig.odd_total,
        tipo: orig.tipo,
        casa: orig.casa,
        stake: orig.stake,
        retorno: 0,
        resultado: "pendente",
        observacoes: orig.observacoes,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row);
  });
