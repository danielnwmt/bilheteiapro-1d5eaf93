// Dashboard e Estatísticas do cliente.
// -----------------------------------------------------------------------------
// Camada de leitura AGREGADA sobre `banca_entradas` (fonte de verdade dos
// resultados: stake, odd, green/red/void) + contagem de bilhetes gerados.
// É 100% aditiva: não altera nenhuma tabela, endpoint ou o motor de análise.
// Toda a matemática é feita no servidor, retornando apenas um DTO simples.
//
// Modelo financeiro por entrada (aposta):
//   green   -> retorno = valor * odd    | lucro = valor * (odd - 1)
//   red     -> retorno = 0              | lucro = -valor
//   anulada -> retorno = valor          | lucro = 0        (void)
//   pendente-> ignorada nas métricas fechadas
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertRecursoPlano } from "./plan-gates.server";

type ResultadoDb = "pendente" | "green" | "red" | "anulada";

type EntradaDb = {
  data: string;
  descricao: string;
  esporte: string;
  valor: number;
  odd: number;
  resultado: ResultadoDb;
  created_at: string;
};

/** Ponto da série de evolução da banca (lucro acumulado por data). */
export type EvolucaoPonto = { data: string; lucro: number; acumulado: number };

/** Agregado por rótulo (dia da semana, esporte, etc.). */
export type AgregadoLabel = {
  label: string;
  lucro: number;
  total: number;
  green: number;
  red: number;
};

export type AtividadeRecente = {
  data: string;
  descricao: string;
  valor: number;
  odd: number;
  resultado: ResultadoDb;
};

export type DashboardResumo = {
  // Contadores de bilhetes/apostas
  bilhetesGerados: number;
  totalApostas: number;
  green: number;
  red: number;
  void: number;
  pendentes: number;
  // Financeiro
  valorApostado: number;
  valorRetornado: number;
  lucroLiquido: number;
  roi: number; // %
  yield: number; // % (lucro / turnover)
  taxaAcerto: number; // % green / (green+red)
  // Odds & stake
  oddMedia: number;
  stakeMedia: number;
  stakeRecomendada: number; // 1 unidade ~ 2% do capital movimentado
  maiorOddVencedora: number;
  maiorOddPerdida: number;
  // Sequências
  seqGreenMax: number;
  seqRedMax: number;
  seqAtual: number; // positivo = greens seguidos, negativo = reds seguidos
  // Séries e agregados
  evolucao: EvolucaoPonto[];
  porDia: AgregadoLabel[];
  porDiaSemana: AgregadoLabel[];
  porEsporte: AgregadoLabel[];
  // Melhor/pior categoria (best-effort a partir do esporte)
  melhorEsporte: AgregadoLabel | null;
  piorEsporte: AgregadoLabel | null;
  melhorDiaSemana: AgregadoLabel | null;
  // Atividades
  atividades: AtividadeRecente[];
  // Assinatura
  membroDesde: string | null;
  diasComoAssinante: number;
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** Retorno financeiro de uma entrada já resolvida. */
function retornoDe(e: EntradaDb): number {
  if (e.resultado === "green") return e.valor * e.odd;
  if (e.resultado === "anulada") return e.valor;
  return 0; // red
}

/** Lucro líquido de uma entrada já resolvida. */
function lucroDe(e: EntradaDb): number {
  if (e.resultado === "green") return e.valor * (e.odd - 1);
  if (e.resultado === "red") return -e.valor;
  return 0; // void
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardResumo> => {
    const { supabase, userId, claims } = context;
    await assertRecursoPlano(
      supabase,
      userId,
      "planilhaBanca",
      claims,
      "Dashboard de performance disponível nos planos com Gestão de Banca.",
    );

    // Leitura em paralelo: entradas da banca + contagem de bilhetes + perfil.
    const [entradasRes, bilhetesRes, perfilRes] = await Promise.all([
      supabase
        .from("banca_entradas")
        .select("data, descricao, esporte, valor, odd, resultado, created_at")
        .eq("user_id", userId)
        .order("data", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("bilhetes").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle(),
    ]);

    const raw = (entradasRes.data ?? []) as any[];
    const entradas: EntradaDb[] = raw.map((e) => ({
      data: e.data,
      descricao: e.descricao ?? "",
      esporte: e.esporte ?? "futebol",
      valor: Number(e.valor) || 0,
      odd: Number(e.odd) || 0,
      resultado: (e.resultado ?? "pendente") as ResultadoDb,
      created_at: e.created_at,
    }));

    const resolvidas = entradas.filter((e) => e.resultado !== "pendente");
    const greens = resolvidas.filter((e) => e.resultado === "green");
    const reds = resolvidas.filter((e) => e.resultado === "red");
    const voids = resolvidas.filter((e) => e.resultado === "anulada");
    const pendentes = entradas.filter((e) => e.resultado === "pendente");

    const valorApostado = resolvidas.reduce((s, e) => s + e.valor, 0);
    const valorRetornado = resolvidas.reduce((s, e) => s + retornoDe(e), 0);
    const lucroLiquido = valorRetornado - valorApostado;
    const roi = valorApostado > 0 ? (lucroLiquido / valorApostado) * 100 : 0;
    const taxaAcerto =
      greens.length + reds.length > 0 ? (greens.length / (greens.length + reds.length)) * 100 : 0;

    const oddMedia = resolvidas.length
      ? resolvidas.reduce((s, e) => s + e.odd, 0) / resolvidas.length
      : 0;
    const stakeMedia = resolvidas.length ? valorApostado / resolvidas.length : 0;
    const maiorOddVencedora = greens.reduce((m, e) => Math.max(m, e.odd), 0);
    const maiorOddPerdida = reds.reduce((m, e) => Math.max(m, e.odd), 0);

    // Sequências (ordem cronológica, ignorando void e pendente).
    let seqGreenMax = 0;
    let seqRedMax = 0;
    let seqAtual = 0;
    let corridaGreen = 0;
    let corridaRed = 0;
    for (const e of resolvidas) {
      if (e.resultado === "green") {
        corridaGreen += 1;
        corridaRed = 0;
        seqGreenMax = Math.max(seqGreenMax, corridaGreen);
        seqAtual = corridaGreen;
      } else if (e.resultado === "red") {
        corridaRed += 1;
        corridaGreen = 0;
        seqRedMax = Math.max(seqRedMax, corridaRed);
        seqAtual = -corridaRed;
      }
    }

    // Evolução da banca: lucro acumulado por data.
    const porDataMap = new Map<
      string,
      { lucro: number; total: number; green: number; red: number }
    >();
    for (const e of resolvidas) {
      const cur = porDataMap.get(e.data) ?? { lucro: 0, total: 0, green: 0, red: 0 };
      cur.lucro += lucroDe(e);
      cur.total += e.valor;
      if (e.resultado === "green") cur.green += 1;
      if (e.resultado === "red") cur.red += 1;
      porDataMap.set(e.data, cur);
    }
    const datasOrdenadas = [...porDataMap.keys()].sort();
    let acc = 0;
    const evolucao: EvolucaoPonto[] = datasOrdenadas.map((d) => {
      const p = porDataMap.get(d)!;
      acc += p.lucro;
      return { data: d, lucro: round2(p.lucro), acumulado: round2(acc) };
    });
    const porDia: AgregadoLabel[] = datasOrdenadas.map((d) => {
      const p = porDataMap.get(d)!;
      return {
        label: d,
        lucro: round2(p.lucro),
        total: round2(p.total),
        green: p.green,
        red: p.red,
      };
    });

    // Agregação por dia da semana.
    const semanaMap = new Map<
      number,
      { lucro: number; total: number; green: number; red: number }
    >();
    for (const e of resolvidas) {
      const wd = new Date(`${e.data}T12:00:00`).getDay();
      const cur = semanaMap.get(wd) ?? { lucro: 0, total: 0, green: 0, red: 0 };
      cur.lucro += lucroDe(e);
      cur.total += e.valor;
      if (e.resultado === "green") cur.green += 1;
      if (e.resultado === "red") cur.red += 1;
      semanaMap.set(wd, cur);
    }
    const porDiaSemana: AgregadoLabel[] = [...semanaMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wd, p]) => ({
        label: DIAS_SEMANA[wd],
        lucro: round2(p.lucro),
        total: round2(p.total),
        green: p.green,
        red: p.red,
      }));

    // Agregação por esporte.
    const esporteMap = new Map<
      string,
      { lucro: number; total: number; green: number; red: number }
    >();
    for (const e of resolvidas) {
      const cur = esporteMap.get(e.esporte) ?? { lucro: 0, total: 0, green: 0, red: 0 };
      cur.lucro += lucroDe(e);
      cur.total += e.valor;
      if (e.resultado === "green") cur.green += 1;
      if (e.resultado === "red") cur.red += 1;
      esporteMap.set(e.esporte, cur);
    }
    const porEsporte: AgregadoLabel[] = [...esporteMap.entries()].map(([label, p]) => ({
      label,
      lucro: round2(p.lucro),
      total: round2(p.total),
      green: p.green,
      red: p.red,
    }));
    const esporteOrd = [...porEsporte].sort((a, b) => b.lucro - a.lucro);
    const semanaOrd = [...porDiaSemana].sort((a, b) => b.lucro - a.lucro);

    // Atividades recentes (últimas 8, mais novas primeiro).
    const atividades: AtividadeRecente[] = [...entradas]
      .reverse()
      .slice(0, 8)
      .map((e) => ({
        data: e.data,
        descricao: e.descricao,
        valor: e.valor,
        odd: e.odd,
        resultado: e.resultado,
      }));

    const membroDesde = (perfilRes.data?.created_at as string | undefined) ?? null;
    const diasComoAssinante = membroDesde
      ? Math.max(0, Math.floor((Date.now() - new Date(membroDesde).getTime()) / 86_400_000))
      : 0;

    return {
      bilhetesGerados: bilhetesRes.count ?? 0,
      totalApostas: entradas.length,
      green: greens.length,
      red: reds.length,
      void: voids.length,
      pendentes: pendentes.length,
      valorApostado: round2(valorApostado),
      valorRetornado: round2(valorRetornado),
      lucroLiquido: round2(lucroLiquido),
      roi: round2(roi),
      yield: round2(roi),
      taxaAcerto: round2(taxaAcerto),
      oddMedia: round2(oddMedia),
      stakeMedia: round2(stakeMedia),
      stakeRecomendada: round2(valorApostado / Math.max(1, resolvidas.length) || 0),
      maiorOddVencedora: round2(maiorOddVencedora),
      maiorOddPerdida: round2(maiorOddPerdida),
      seqGreenMax,
      seqRedMax,
      seqAtual,
      evolucao,
      porDia,
      porDiaSemana,
      porEsporte,
      melhorEsporte: esporteOrd[0] ?? null,
      piorEsporte: esporteOrd.length > 1 ? esporteOrd[esporteOrd.length - 1] : null,
      melhorDiaSemana: semanaOrd[0] ?? null,
      atividades,
      membroDesde,
      diasComoAssinante,
    };
  });
