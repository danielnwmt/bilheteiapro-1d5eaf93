// Mapa central de planos e do que cada um libera (espelha a tabela comparativa).
// Client-safe: sem imports de servidor.

export type Plano = "start" | "pro" | "elite";

export const PLANOS: Plano[] = ["start", "pro", "elite"];

export const PLANO_INFO: Record<
  Plano,
  { nome: string; preco: string; priceId: string; descricao: string; nivel: number }
> = {
  start: {
    nome: "BilheteIA Start",
    preco: "R$ 29,90",
    priceId: "start_monthly",
    descricao: "Para quem busca múltiplas inteligentes com IA.",
    nivel: 1,
  },
  pro: {
    nome: "BilheteIA Pro",
    preco: "R$ 49,90",
    priceId: "pro_monthly",
    descricao: "Todas as ligas mundiais e ferramentas de gestão.",
    nivel: 2,
  },
  elite: {
    nome: "BilheteIA Elite",
    preco: "R$ 79,90",
    priceId: "elite_monthly",
    descricao: "Tudo, em tempo real e com suporte prioritário.",
    nivel: 3,
  },
};

// Ligas liberadas por plano (nomes iguais aos usados no gerador).
const LIGAS_START = ["Brasileirão Série A", "Brasileirão Série B", "Premier League"];
const LIGAS_PRO_EXTRA = [
  "Copa do Brasil",
  "Libertadores",
  "Sul-Americana",
  "La Liga",
  "Serie A (Itália)",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
  "Conference League",
  "Copa do Mundo",
];

export const LIGAS_POR_PLANO: Record<Plano, string[]> = {
  start: LIGAS_START,
  pro: [...LIGAS_START, ...LIGAS_PRO_EXTRA],
  elite: [...LIGAS_START, ...LIGAS_PRO_EXTRA],
};

export const HISTORICO_DIAS: Record<Plano, number> = {
  start: 15,
  pro: 30,
  elite: 60,
};

export type Recurso =
  | "bilhetesIlimitados"
  | "oddPersonalizada"
  | "planilhaBanca"
  | "favoritos"
  | "estatisticasAvancadas"
  | "tempoReal"
  | "alertasInteligentes"
  | "suportePrioritario";

export const RECURSOS_POR_PLANO: Record<Plano, Record<Recurso, boolean>> = {
  start: {
    bilhetesIlimitados: true,
    oddPersonalizada: true,
    planilhaBanca: false,
    favoritos: false,
    estatisticasAvancadas: false,
    tempoReal: false,
    alertasInteligentes: false,
    suportePrioritario: false,
  },
  pro: {
    bilhetesIlimitados: true,
    oddPersonalizada: true,
    planilhaBanca: true,
    favoritos: true,
    estatisticasAvancadas: true,
    tempoReal: false,
    alertasInteligentes: false,
    suportePrioritario: false,
  },
  elite: {
    bilhetesIlimitados: true,
    oddPersonalizada: true,
    planilhaBanca: true,
    favoritos: true,
    estatisticasAvancadas: true,
    tempoReal: true,
    alertasInteligentes: true,
    suportePrioritario: true,
  },
};

export function ligaLiberada(plano: Plano | null, liga: string): boolean {
  if (!plano) return false;
  return LIGAS_POR_PLANO[plano].includes(liga);
}

export function recursoLiberado(plano: Plano | null, recurso: Recurso): boolean {
  if (!plano) return false;
  return RECURSOS_POR_PLANO[plano][recurso];
}

// Linhas da tabela comparativa (rótulo + por plano).
type CompCell = boolean | string;
export const COMPARATIVO: Array<{ recurso: string; start: CompCell; pro: CompCell; elite: CompCell }> = [
  { recurso: "Bilhetes ilimitados", start: true, pro: true, elite: true },
  { recurso: "Odd personalizada", start: true, pro: true, elite: true },
  { recurso: "Brasileirão Série A", start: true, pro: true, elite: true },
  { recurso: "Brasileirão Série B", start: true, pro: true, elite: true },
  { recurso: "Premier League", start: true, pro: true, elite: true },
  { recurso: "Copa do Brasil", start: false, pro: true, elite: true },
  { recurso: "Libertadores", start: false, pro: true, elite: true },
  { recurso: "Sul-Americana", start: false, pro: true, elite: true },
  { recurso: "La Liga", start: false, pro: true, elite: true },
  { recurso: "Serie A (Itália)", start: false, pro: true, elite: true },
  { recurso: "Bundesliga", start: false, pro: true, elite: true },
  { recurso: "Ligue 1", start: false, pro: true, elite: true },
  { recurso: "Champions League", start: false, pro: true, elite: true },
  { recurso: "Europa League", start: false, pro: true, elite: true },
  { recurso: "Conference League", start: false, pro: true, elite: true },
  { recurso: "Copa do Mundo", start: false, pro: true, elite: true },
  { recurso: "Planilha de Gestão de Banca", start: false, pro: true, elite: true },
  { recurso: "Favoritos", start: false, pro: true, elite: true },
  { recurso: "Estatísticas avançadas", start: false, pro: true, elite: true },
  { recurso: "Histórico", start: "15 dias", pro: "30 dias", elite: "60 dias" },
  { recurso: "Atualização em tempo real", start: false, pro: false, elite: true },
  { recurso: "Alertas inteligentes", start: false, pro: false, elite: true },
  { recurso: "Suporte prioritário", start: false, pro: false, elite: true },
];
