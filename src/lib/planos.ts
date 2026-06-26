// Tipos e listas-mestras dos planos. Os VALORES (preço, ligas, recursos, etc.)
// vivem no banco (tabela plano_config) e são editáveis pelo admin.
// Client-safe: sem imports de servidor.

// Plano é texto livre: além de start/pro/elite, o admin pode criar novos.
export type Plano = string;

export const PLANOS: Plano[] = ["start", "pro", "elite"];

export type Recurso =
  | "bilhetesIlimitados"
  | "oddPersonalizada"
  | "planilhaBanca"
  | "favoritos"
  | "estatisticasAvancadas"
  | "tempoReal"
  | "alertasInteligentes"
  | "suportePrioritario";

// Lista-mestra de recursos (rótulos para a tela de configurações e o comparativo).
export const RECURSO_LABELS: { key: Recurso; label: string }[] = [
  { key: "bilhetesIlimitados", label: "Bilhetes ilimitados" },
  { key: "oddPersonalizada", label: "Odd personalizada" },
  { key: "planilhaBanca", label: "Planilha de Gestão de Banca" },
  { key: "favoritos", label: "Favoritos" },
  { key: "estatisticasAvancadas", label: "Estatísticas avançadas" },
  { key: "tempoReal", label: "Atualização em tempo real" },
  { key: "alertasInteligentes", label: "Alertas inteligentes" },
  { key: "suportePrioritario", label: "Suporte prioritário" },
];

// Universo de ligas que podem ser liberadas por plano.
export const TODAS_LIGAS: string[] = [
  "Brasileirão Série A",
  "Brasileirão Série B",
  "Copa do Brasil",
  "Libertadores",
  "Sul-Americana",
  "Premier League",
  "La Liga",
  "Serie A (Itália)",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
  "Conference League",
  "Copa do Mundo",
];

export type PlanoConfig = {
  plano: Plano;
  nome: string;
  preco: string;
  descricao: string;
  nivel: number;
  priceId: string;
  historicoDias: number;
  ligas: string[];
  recursos: Record<Recurso, boolean>;
  descontoSemestral: number; // % de desconto na contratação de 6 meses
  descontoAnual: number; // % de desconto na contratação de 12 meses
};

export type Ciclo = "mensal" | "semestral" | "anual";

export const CICLO_MESES: Record<Ciclo, number> = {
  mensal: 1,
  semestral: 6,
  anual: 12,
};

export const CICLO_LABEL: Record<Ciclo, string> = {
  mensal: "Mensal",
  semestral: "Semestral",
  anual: "Anual",
};

// Converte "R$ 29,90" -> 2990 (centavos). Retorna 0 se não conseguir.
export function precoParaCentavos(preco: string): number {
  const digits = String(preco).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "");
  const normalized = digits.replace(",", ".");
  const valor = Number.parseFloat(normalized);
  return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
}

export function formatarReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function descontoDoCiclo(cfg: PlanoConfig, ciclo: Ciclo): number {
  if (ciclo === "semestral") return Math.max(0, Math.min(100, cfg.descontoSemestral || 0));
  if (ciclo === "anual") return Math.max(0, Math.min(100, cfg.descontoAnual || 0));
  return 0;
}

// Preço TOTAL do ciclo (em centavos), já com desconto aplicado.
export function precoCicloCentavos(cfg: PlanoConfig, ciclo: Ciclo): number {
  const mensal = precoParaCentavos(cfg.preco);
  const meses = CICLO_MESES[ciclo];
  const desconto = descontoDoCiclo(cfg, ciclo);
  const bruto = mensal * meses;
  return Math.round(bruto * (1 - desconto / 100));
}

// Preço equivalente POR MÊS (em centavos) no ciclo escolhido.
export function precoMensalEquivalenteCentavos(cfg: PlanoConfig, ciclo: Ciclo): number {
  return Math.round(precoCicloCentavos(cfg, ciclo) / CICLO_MESES[ciclo]);
}

export function recursosVazios(): Record<Recurso, boolean> {
  return RECURSO_LABELS.reduce(
    (acc, r) => ({ ...acc, [r.key]: false }),
    {} as Record<Recurso, boolean>,
  );
}

export function ligaLiberada(cfg: PlanoConfig | null | undefined, liga: string): boolean {
  if (!cfg) return false;
  return cfg.ligas.includes(liga);
}

export function recursoLiberado(cfg: PlanoConfig | null | undefined, recurso: Recurso): boolean {
  if (!cfg) return false;
  return !!cfg.recursos[recurso];
}
