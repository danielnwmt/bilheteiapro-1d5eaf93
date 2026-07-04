// Favoritos do cliente.
// -----------------------------------------------------------------------------
// CRUD sobre `public.favoritos`. Permite marcar campeonatos, jogos, mercados,
// times e bilhetes como favoritos. O sistema pode usar esses dados para
// priorizar sugestões (leitura via getFavoritos).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type TipoFavorito = "campeonato" | "jogo" | "mercado" | "time" | "bilhete";

export type Favorito = {
  id: string;
  tipo: TipoFavorito;
  valor: string;
  rotulo: string | null;
  metadata: Json;
  created_at: string;
};

function mapRow(r: any): Favorito {
  return {
    id: r.id,
    tipo: r.tipo as TipoFavorito,
    valor: r.valor,
    rotulo: r.rotulo ?? null,
    metadata: (r.metadata ?? {}) as Json,
    created_at: r.created_at,
  };
}

/** Lista todos os favoritos do usuário. */
export const listFavoritos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Favorito[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("favoritos")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapRow);
  });

/** Adiciona um favorito (idempotente por tipo+valor). */
export const addFavorito = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { tipo: TipoFavorito; valor: string; rotulo?: string | null; metadata?: Record<string, unknown> }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.valor?.trim()) throw new Error("Valor do favorito é obrigatório.");
    const { data: row, error } = await supabase
      .from("favoritos")
      .upsert(
        {
          user_id: userId,
          tipo: data.tipo,
          valor: data.valor.trim(),
          rotulo: data.rotulo ?? data.valor.trim(),
          metadata: data.metadata ?? {},
        },
        { onConflict: "user_id,tipo,valor" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row);
  });

/** Remove um favorito por id OU por tipo+valor (toggle). */
export const removeFavorito = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; tipo?: TipoFavorito; valor?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("favoritos").delete().eq("user_id", userId);
    if (data.id) q = q.eq("id", data.id);
    else if (data.tipo && data.valor) q = q.eq("tipo", data.tipo).eq("valor", data.valor.trim());
    else throw new Error("Informe id ou tipo+valor.");
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
