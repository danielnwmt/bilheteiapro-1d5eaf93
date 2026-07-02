// Regras de exclusão mútua (correlação negativa) entre seleções do MESMO jogo.
// Impede que o gerador de bilhetes combine mercados contraditórios, por exemplo
// "Ambas Marcam: Não" com "Mais de 2.5 Gols".
//
// Funciona classificando cada seleção em "tags" semânticas e cruzando-as numa
// matriz de conflitos. É puro (sem dependências), então pode ser importado no
// cliente e no servidor.

function norm(v: string) {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SelecaoMercado {
  mercado: string;
  selecao: string;
}

// Extrai a linha de gols de textos como "mais de 2.5", "over 2.5", "+2.5".
function linhaDeGols(txt: string): number | null {
  const m = txt.match(/(?:mais de|over|acima de|\+)\s*(\d+(?:\.\d+)?)/);
  if (m) return Number(m[1]);
  const m2 = txt.match(/\b(\d+\.\d+)\b/);
  return m2 ? Number(m2[1]) : null;
}

type Tag =
  | "btts_nao"
  | "btts_sim"
  | "placar_00"
  | "over_05"
  | "over_25"
  | "dupla_12"
  | "dnb";

// Converte mercado+seleção num conjunto de tags semânticas.
export function classificarSelecao(p: SelecaoMercado): Set<Tag> {
  const t = norm(`${p.mercado} ${p.selecao}`);
  const tags = new Set<Tag>();

  const ehGols = /gol|goal|total/.test(t);
  const linha = linhaDeGols(t);
  const temMais = /(mais de|over|acima de|\+\s*\d)/.test(t);

  // Ambas marcam (BTTS)
  if (/ambas|both teams|btts/.test(t)) {
    if (/\bnao\b|\bno\b/.test(t)) tags.add("btts_nao");
    else if (/\bsim\b|\byes\b/.test(t)) tags.add("btts_sim");
  }

  // Placar exato 0x0
  if (/placar|correct score|resultado exato/.test(t) && /0\s*[x-]\s*0|\b0 0\b/.test(t)) {
    tags.add("placar_00");
  }

  // Mais de X.5 gols
  if (ehGols && temMais && linha != null) {
    if (linha >= 0.5) tags.add("over_05");
    if (linha >= 2.5) tags.add("over_25");
  }

  // Dupla chance Casa ou Fora (12)
  if (/dupla chance|double chance/.test(t) && (/\b12\b/.test(t) || /(casa|home).*(fora|away)|(fora|away).*(casa|home)/.test(t))) {
    tags.add("dupla_12");
  }

  // Empate anula (DNB)
  if (/empate anula|dnb|draw no bet/.test(t)) {
    tags.add("dnb");
  }

  return tags;
}

// Matriz de pares que NÃO podem coexistir no mesmo bilhete (mesmo jogo).
const PARES_CONFLITANTES: Array<[Tag, Tag]> = [
  // "Ambas Marcam: Não" x "Mais de 2.5 Gols" (ou superior)
  ["btts_nao", "over_25"],
  // "Placar Exato: 0x0" x "Mais de 0.5 Gols"
  ["placar_00", "over_05"],
  // "Placar Exato: 0x0" x "Ambas Marcam: Sim"
  ["placar_00", "btts_sim"],
  // "Dupla Chance: 12" x "Empate Anula (DNB)"
  ["dupla_12", "dnb"],
];

// Retorna true se as duas seleções são contraditórias/correlação negativa.
export function selecoesConflitam(a: SelecaoMercado, b: SelecaoMercado): boolean {
  const ta = classificarSelecao(a);
  const tb = classificarSelecao(b);
  return PARES_CONFLITANTES.some(
    ([x, y]) => (ta.has(x) && tb.has(y)) || (ta.has(y) && tb.has(x)),
  );
}

// ---------------------------------------------------------------------------
// Grupos de categoria (diversificação obrigatória do bilhete).
// Cada mercado cai em UM dos 4 grandes grupos. O gerador limita o número de
// seleções por grupo para evitar bilhetes "de um mercado só" (ex.: só gols).
// ---------------------------------------------------------------------------
export type GrupoCategoria =
  | "resultado" // 1X2, Dupla chance, DNB, Handicap asiático, Placar exato
  | "gols" // Mais/Menos gols, Ambas marcam, Gols 1º tempo, Time marca
  | "escanteios" // Total de escanteios, Escanteios Mais/Menos
  | "cartoes" // Total de cartões, Cartões Mais/Menos
  | "outro";

export function grupoDoMercado(p: SelecaoMercado): GrupoCategoria {
  const t = norm(`${p.mercado} ${p.selecao}`);

  // Escanteios (checa antes de gols porque pode conter "mais/menos").
  if (/escanteio|corner|corners/.test(t)) return "escanteios";

  // Cartões
  if (/cartao|cartoes|card|cards|amarelo|vermelho/.test(t)) return "cartoes";

  // Gols / ambas marcam / time marca / 1º tempo
  if (
    /gol|goal|ambas|both teams|btts|marca|score|1o tempo|1 tempo|primeiro tempo|first half/.test(
      t,
    )
  ) {
    return "gols";
  }

  // Resultado / geral
  if (
    /1x2|resultado|match winner|vencedor|dupla chance|double chance|empate anula|dnb|draw no bet|handicap|placar|correct score/.test(
      t,
    )
  ) {
    return "resultado";
  }

  return "outro";
}

