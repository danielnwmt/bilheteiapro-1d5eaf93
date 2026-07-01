// Definição do FLUXO das APIs: qual API faz cada etapa do sistema.
// Client-safe (sem segredos) — usado pelo painel e lido no servidor.

export interface ApiFlowStep {
  id: string;
  label: string;
  descricao: string;
  apis: string[]; // APIs permitidas para essa etapa (1ª = padrão)
  opcional?: boolean; // permite "Desligado"
}

// Rótulos amigáveis das chaves de API.
export const API_LABEL: Record<string, string> = {
  API_FOOTBALL_KEY: "API-Football",
  GEMINI_API_KEY: "IA (Gemini)",
};

// Etapas do fluxo, em ordem de execução.
export const FLUXO_ETAPAS: ApiFlowStep[] = [
  {
    id: "jogos",
    label: "Buscar jogos",
    descricao: "Lista as partidas do dia e os campeonatos.",
    apis: ["API_FOOTBALL_KEY"],
  },
  {
    id: "odds",
    label: "Atualizar odds",
    descricao: "Coleta e atualiza os valores das odds das casas.",
    apis: ["API_FOOTBALL_KEY"],
  },
  {
    id: "analise",
    label: "Montar múltipla (análise)",
    descricao: "Analisa os jogos e monta os bilhetes.",
    apis: ["GEMINI_API_KEY"],
  },
];

// Mapa padrão (etapa -> API).
export const FLUXO_PADRAO: Record<string, string> = Object.fromEntries(
  FLUXO_ETAPAS.map((e) => [e.id, e.apis[0]]),
);

// Mescla um mapa salvo com o padrão, garantindo todas as etapas.
export function mergeFlow(saved: unknown): Record<string, string> {
  const base = { ...FLUXO_PADRAO };
  if (saved && typeof saved === "object") {
    for (const e of FLUXO_ETAPAS) {
      const v = (saved as Record<string, unknown>)[e.id];
      if (typeof v === "string") base[e.id] = v;
    }
  }
  return base;
}

export function parseFlow(raw: string | null | undefined): Record<string, string> {
  if (!raw) return { ...FLUXO_PADRAO };
  try {
    return mergeFlow(JSON.parse(raw));
  } catch {
    return { ...FLUXO_PADRAO };
  }
}
