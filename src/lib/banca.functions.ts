import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Resultado = "pendente" | "green" | "red" | "anulada";

export type BancaEntrada = {
  id: string;
  data: string;
  descricao: string;
  esporte: string;
  valor: number;
  odd: number;
  resultado: Resultado;
};

// Garante que o cliente tem o recurso "planilhaBanca" liberado no plano ativo.
async function assertBancaLiberada(supabase: any, userId: string) {
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plano, status, periodo_fim")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ativo =
    sub?.status === "ativo" && (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());
  if (!ativo || !sub?.plano) throw new Error("Recurso disponível apenas em planos ativos.");

  const { data: cfg } = await supabase
    .from("plano_config")
    .select("recursos")
    .eq("plano", sub.plano)
    .maybeSingle();

  if (!cfg?.recursos?.planilhaBanca) {
    throw new Error("A Planilha de Gestão de Banca está disponível nos planos Pro e Elite.");
  }
}

export const listBancaEntradas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertBancaLiberada(supabase, userId);
    const { data, error } = await supabase
      .from("banca_entradas")
      .select("id, data, descricao, valor, odd, resultado")
      .eq("user_id", userId)
      .order("data", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((e) => ({
      ...e,
      valor: Number(e.valor),
      odd: Number(e.odd),
    })) as BancaEntrada[];
  });

export const addBancaEntrada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { data: string; descricao: string; valor: number; odd: number; resultado: Resultado }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBancaLiberada(supabase, userId);
    if (!data.descricao.trim()) throw new Error("Informe a descrição da aposta.");
    const { error } = await supabase.from("banca_entradas").insert({
      user_id: userId,
      data: data.data || new Date().toISOString().slice(0, 10),
      descricao: data.descricao.trim(),
      valor: data.valor,
      odd: data.odd,
      resultado: data.resultado,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateBancaEntrada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      data: string;
      descricao: string;
      valor: number;
      odd: number;
      resultado: Resultado;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBancaLiberada(supabase, userId);
    const { error } = await supabase
      .from("banca_entradas")
      .update({
        data: data.data,
        descricao: data.descricao.trim(),
        valor: data.valor,
        odd: data.odd,
        resultado: data.resultado,
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBancaEntrada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBancaLiberada(supabase, userId);
    const { error } = await supabase
      .from("banca_entradas")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
