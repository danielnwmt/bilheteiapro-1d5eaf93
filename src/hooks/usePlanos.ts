import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PLANOS,
  recursosVazios,
  type Plano,
  type PlanoConfig,
  type Recurso,
} from "@/lib/planos";

function mapRow(row: any): PlanoConfig {
  const recursos = { ...recursosVazios(), ...(row.recursos ?? {}) } as Record<Recurso, boolean>;
  return {
    plano: row.plano as Plano,
    nome: row.nome,
    preco: row.preco,
    descricao: row.descricao,
    nivel: row.nivel,
    priceId: row.price_id,
    historicoDias: row.historico_dias,
    ligas: Array.isArray(row.ligas) ? (row.ligas as string[]) : [],
    recursos,
  };
}

export function usePlanos() {
  const query = useQuery({
    queryKey: ["plano_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plano_config")
        .select("*")
        .order("nivel", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    staleTime: 30_000,
  });

  const list = (query.data ?? []).slice().sort((a, b) => a.nivel - b.nivel);
  const byPlano = Object.fromEntries(list.map((c) => [c.plano, c])) as Record<Plano, PlanoConfig>;
  // Ordena pelos canônicos (Start/Pro/Elite) primeiro e mantém os planos novos no fim.
  const canonicos = PLANOS.map((p) => byPlano[p]).filter(Boolean) as PlanoConfig[];
  const extras = list.filter((c) => !PLANOS.includes(c.plano));
  const ordered = [...canonicos, ...extras];

  return { ...query, list: ordered.length ? ordered : list, byPlano };
}
