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
};

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
