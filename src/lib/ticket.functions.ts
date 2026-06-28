import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { getAiModel } from "./ai-gateway.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type Plano } from "./planos";

const InputSchema = z.object({
  oddAlvo: z.number().min(1.1).max(1000),
  periodo: z.enum(["hoje", "amanha", "semana", "aovivo"]),
  campeonatos: z.array(z.string()).optional().default([]),
  mercados: z.array(z.string()).optional().default([]),
  casa: z.string().optional().default("Betano"),
  minConfianca: z.number().min(0).max(100).optional().default(0),
});

const PickSchema = z.object({
  jogo: z.string(),
  data: z.string(),
  mercado: z.string(),
  selecao: z.string(),
  oddEstimada: z.number(),
  confianca: z.number(),
  justificativa: z.string(),
  deepLink: z.string().optional(),
});

const AnaliseJogoSchema = z.object({
  jogo: z.string(),
  escanteios: z.string(),
  gols: z.string(),
  chutesAoGol: z.string(),
  cartoesTimes: z.string(),
  cartoesArbitro: z.string(),
});

const TicketSchema = z.object({
  resumo: z.string(),
  picks: z.array(PickSchema),
  analiseJogos: z.array(AnaliseJogoSchema).default([]),
  oddTotal: z.number(),
  risco: z.enum(["baixo", "medio", "alto"]),
  observacoes: z.string(),
});

type Ticket = z.infer<typeof TicketSchema>;
type Periodo = z.infer<typeof InputSchema>["periodo"];

// ---------- utils ----------
function saoPauloParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

// Offset (ms) entre UTC e America/Sao_Paulo no instante dado.
function spOffsetMs(now = new Date()) {
  const p = saoPauloParts(now);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - new Date(now).setSeconds(0, 0);
}

function periodRange(periodo: Periodo, now = new Date()) {
  const offset = spOffsetMs(now);
  const p = saoPauloParts(now);
  const startOfDaySP = Date.UTC(p.year, p.month - 1, p.day) - offset;
  const dayMs = 86400000;
  if (periodo === "hoje") return { from: now.getTime(), to: startOfDaySP + dayMs };
  if (periodo === "amanha") return { from: startOfDaySP + dayMs, to: startOfDaySP + 2 * dayMs };
  if (periodo === "semana") return { from: now.getTime(), to: startOfDaySP + 8 * dayMs };
  return { from: now.getTime() - 4 * 3600000, to: now.getTime() }; // aovivo
}

function formatMatchDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function riskFromPicks(picks: Ticket["picks"], oddTotal: number): Ticket["risco"] {
  const avg = picks.length ? picks.reduce((s, p) => s + p.confianca, 0) / picks.length : 0;
  if (oddTotal >= 8 || avg < 55) return "alto";
  if (oddTotal <= 3 && avg >= 70) return "baixo";
  return "medio";
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function extractJson(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON não encontrado");
  return cleaned.slice(start, end + 1);
}

// Remove trailing commas e tenta fechar JSON truncado (saída da IA cortada)
function repairJson(input: string) {
  let s = input.replace(/,\s*([}\]])/g, "$1");
  const opens: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") opens.push(ch);
    else if (ch === "}" || ch === "]") opens.pop();
  }
  if (inString) s += '"';
  while (opens.length) {
    const o = opens.pop();
    s += o === "{" ? "}" : "]";
  }
  return s.replace(/,\s*([}\]])/g, "$1");
}

function parseAiJson(text: string): Record<string, unknown> {
  const extracted = extractJson(text);
  try {
    return JSON.parse(extracted) as Record<string, unknown>;
  } catch {
    return JSON.parse(repairJson(extracted)) as Record<string, unknown>;
  }
}


function normKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Aliases (PT + nomes da API em inglês) para casar o filtro de campeonato com o
// que foi gravado na coluna "liga" (que pode vir em inglês quando o id da liga
// não está no mapa de tradução).
const LIGA_ALIASES: Record<string, string[]> = {
  "brasileirao serie a": ["brasileirao serie a", "serie a brazil", "brazil serie a", "brasileirao"],
  "brasileirao serie b": ["brasileirao serie b", "serie b brazil", "brazil serie b"],
  "copa do brasil": ["copa do brasil", "brazil cup"],
  "libertadores": ["libertadores", "copa libertadores", "conmebol libertadores"],
  "sul americana": ["sul americana", "copa sudamericana", "conmebol sudamericana", "sudamericana"],
  "premier league": ["premier league", "english premier league", "epl"],
  "la liga": ["la liga", "laliga", "primera division"],
  "serie a italia": ["serie a italia", "serie a", "italy serie a"],
  "bundesliga": ["bundesliga", "1 bundesliga", "germany bundesliga"],
  "ligue 1": ["ligue 1", "france ligue 1"],
  "champions league": ["champions league", "uefa champions league", "liga dos campeoes"],
  "europa league": ["europa league", "uefa europa league", "liga europa"],
  "conference league": ["conference league", "uefa europa conference league", "europa conference league"],
  "copa do mundo": ["copa do mundo", "world cup", "fifa world cup", "copa do mundo fifa"],
};

function ligaMatchesSelecao(liga: string | null, campeonatos: string[]) {
  if (!campeonatos.length) return true;
  if (!liga) return false;
  const ligaKey = normKey(liga);
  return campeonatos.some((c) => {
    const ck = normKey(c);
    if (ligaKey === ck) return true;
    const aliases = LIGA_ALIASES[ck];
    return aliases ? aliases.some((a) => ligaKey === a) : false;
  });
}


type OddRow = { casa: string; mercado: string; selecao: string; valor: number; external_odd_id: string | null };
type PartidaRow = {
  id: string;
  external_id: string | null;
  liga: string | null;
  time_casa: string;
  time_fora: string;
  inicio: string;
  status: string;
  odds: OddRow[];
};

function buildDeepLink(
  templates: Array<{ casa: string; mercado: string | null; url_template: string }>,
  casa: string,
  jogo: string,
  pick: { mercado: string; selecao: string },
  oddId: string | null,
) {
  const casaKey = normKey(casa);
  const candidates = templates.filter((t) => normKey(t.casa) === casaKey);
  if (!candidates.length) return undefined;
  const byMarket = candidates.find((t) => t.mercado && normKey(t.mercado) === normKey(pick.mercado));
  const tpl = (byMarket ?? candidates.find((t) => !t.mercado) ?? candidates[0]).url_template;
  return tpl
    .replaceAll("{jogo}", encodeURIComponent(jogo))
    .replaceAll("{selecao}", encodeURIComponent(pick.selecao))
    .replaceAll("{odd_id}", oddId ? encodeURIComponent(oddId) : "");
}

export const gerarBilhete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const aiModel = await getAiModel();

    // ---- Controle de acesso por plano ----
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: roleRows }, { data: userData }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", context.userId),
      supabaseAdmin.auth.admin.getUserById(context.userId),
    ]);
    const roles = (roleRows ?? []).map((r) => r.role);
    const userEmail = String(userData.user?.email ?? (context.claims as any)?.email ?? "").trim().toLowerCase();
    const isStaff = roles.includes("admin") || roles.includes("operador") || userEmail === "contato@protenexus.com";

    let plano: Plano | null = null;
    if (!isStaff) {
      const { data: sub } = await supabaseAdmin
        .from("subscriptions")
        .select("plano, status, periodo_fim")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ativo =
        (sub?.status === "ativo" || sub?.status === "cortesia") &&
        (!sub?.periodo_fim || new Date(sub.periodo_fim) > new Date());
      plano = ativo ? (sub!.plano as Plano) : null;
      if (!plano) {
        throw new Error("Assine um plano para gerar bilhetes. Acesse a página de planos.");
      }
    }

    // Ligas/recursos liberados: staff vê tudo; cliente, conforme o plano (lido do banco).
    let ligasLiberadas: string[] | null = null;
    let permiteTempoReal = true;
    if (!isStaff) {
      const { data: cfg } = await supabaseAdmin
        .from("plano_config")
        .select("ligas, recursos")
        .eq("plano", plano as Plano)
        .maybeSingle();
      ligasLiberadas = Array.isArray(cfg?.ligas) ? (cfg!.ligas as string[]) : [];
      permiteTempoReal = !!(cfg?.recursos as Record<string, boolean> | null)?.tempoReal;
    }

    // Tempo real (ao vivo) só se o plano liberar o recurso.
    if (!isStaff && data.periodo === "aovivo" && !permiteTempoReal) {
      throw new Error("Atualização em tempo real não está incluída no seu plano.");
    }

    // Restringe campeonatos selecionados aos liberados pelo plano.
    if (ligasLiberadas) {
      if (data.campeonatos.length) {
        const permitidos = data.campeonatos.filter((c) => ligasLiberadas.includes(c));
        if (!permitidos.length) {
          throw new Error("Os campeonatos escolhidos não estão no seu plano. Faça upgrade.");
        }
        data.campeonatos = permitidos;
      } else {
        // "qualquer campeonato" vira "qualquer um dos liberados pelo plano".
        data.campeonatos = ligasLiberadas;
      }
    }

    const now = new Date();
    const { from, to } = periodRange(data.periodo, now);


    const nowIso = now.toISOString();
    const lerPartidas = async () => {
      const query = supabaseAdmin
        .from("partidas")
        .select("id, external_id, liga, time_casa, time_fora, inicio, status, odds(casa, mercado, selecao, valor, external_odd_id)")
        .gte("inicio", new Date(from).toISOString())
        .lte("inicio", new Date(to).toISOString())
        .neq("status", "encerrado")
        .order("inicio", { ascending: true })
        .limit(120);
      const res = await query;
      if (res.error) return res;
      const filtradas = (res.data ?? []).filter((p) => {
        if (!ligaMatchesSelecao(p.liga, data.campeonatos)) return false;
        // Nunca incluir jogos já encerrados.
        if (p.status === "encerrado") return false;
        if (data.periodo === "aovivo") {
          // Ao vivo: só jogos efetivamente em andamento.
          return p.status === "ao_vivo";
        }
        // Demais períodos: o jogo ainda não pode ter começado.
        return p.inicio >= nowIso;
      });
      return { ...res, data: filtradas };
    };



    let { data: partidas, error } = await lerPartidas();
    if (error) {
      console.error("Erro ao ler partidas", error);
      throw new Error("Não foi possível ler os jogos do banco. Tente novamente.");
    }

    let rows = (partidas ?? []) as PartidaRow[];
    if (!rows.length) {
      throw new Error(
        data.periodo === "aovivo"
          ? "Nenhum jogo ao vivo salvo no banco ainda. Aguarde a sincronização automática configurada no painel."
          : "Nenhum jogo salvo no banco para esse período ainda. Aguarde a sincronização automática configurada no painel.",
      );
    }

    // Gerar bilhete NÃO chama API-Football. Usa somente odds já salvas no banco.
    rows = rows.filter((r) => r.odds.some((o) => normKey(o.casa) === normKey(data.casa)));
    if (!rows.length) {
      throw new Error(`Os jogos desse período ainda não têm odds salvas para ${data.casa}. Aguarde a sincronização automática configurada no painel.`);
    }

    // Texto para a IA com jogos + odds reais disponíveis
    const jogosTexto = rows
      .map((r) => {
        const jogo = `${r.time_casa} x ${r.time_fora}`;
        const oddsTxt = r.odds.length
          ? r.odds
              .filter((o) => normKey(o.casa) === normKey(data.casa))
              .map((o) => `${o.mercado} / ${o.selecao} @ ${o.valor}`)
              .join("; ")
          : "";
        return `${formatMatchDate(r.inicio)} | ${jogo}${r.liga ? ` | ${r.liga}` : ""}${oddsTxt ? `\n  Odds (${data.casa}): ${oddsTxt}` : ""}`;
      })
      .join("\n")
      .slice(0, 14000);

    

    const system = `Você é um analista esportivo de futebol especializado em apostas.
Receberá uma lista de jogos com odds reais disponíveis na casa "${data.casa}".
Monte uma aposta múltipla (bilhete) cuja odd total combinada se aproxime ao máximo da odd alvo informada.

Regras:
- Use SOMENTE jogos e mercados/seleções presentes na lista. Nunca invente.
- Quando houver odd listada para a seleção escolhida, use exatamente esse valor em oddEstimada.
- OBJETIVO PRINCIPAL: a MULTIPLICAÇÃO de todas as odds individuais deve bater a odd alvo (ficar a ±15% dela). Continue adicionando seleções até o produto chegar na odd alvo.
- Para alcançar a odd alvo combine VÁRIAS seleções: use vários jogos e, quando necessário, mais de um mercado INDEPENDENTE do MESMO jogo (ex.: resultado + escanteios + cartões). Nunca combine seleções contraditórias do mesmo mercado.
- Priorize sempre as seleções de MAIOR confiança possível, mas o mais importante é ATINGIR a odd alvo. Não descarte o bilhete por causa da confiança.
- Sempre informe a confiança real (0 a 100) de cada seleção em "confianca". Esse percentual será exibido ao usuário.
- Se mesmo usando todos os jogos/mercados disponíveis o produto não chegar à odd alvo, retorne o bilhete possível mais próximo e diga isso claramente no campo "observacoes".
- Considere forma recente, mando de campo, confrontos diretos e contexto.
- Justificativas curtas e diretas, em português.
- IMPORTANTE: quando houver MAIS DE UMA seleção no mesmo jogo, inclua esse jogo em "analiseJogos" com estimativas de: escanteios (média e linha provável), gols (média de gols na partida), chutes ao gol (média por time), média de cartões dos times e média de cartões do árbitro da partida. Cada campo deve ser curto (1 frase com números).${
      data.mercados.length
        ? `\n- RESTRIÇÃO DE MERCADOS: o usuário escolheu apostar SOMENTE nestes tipos de mercado: ${data.mercados.join(", ")}. Use exclusivamente seleções desses mercados. Se um jogo não tiver esses mercados, ignore-o. Se mesmo assim não atingir a odd alvo, retorne o melhor bilhete possível com esses mercados e explique em "observacoes".`
        : ""
    }`;

    const periodoLabel = { hoje: "hoje", amanha: "amanhã", semana: "próximos dias", aovivo: "AO VIVO agora" }[data.periodo];
    const prompt = `Período: ${periodoLabel}
Odd alvo da múltipla: ${data.oddAlvo}
Casa de aposta: ${data.casa}

Jogos disponíveis no banco:
${jogosTexto}

Monte o bilhete combinando seleções suficientes para ATINGIR a odd alvo (±15%). Informe a confiança real de cada seleção.

Responda SOMENTE com JSON válido neste formato:
{
  "resumo": "texto curto",
  "picks": [{ "jogo": "Time A x Time B", "data": "horário/data", "mercado": "mercado", "selecao": "palpite", "oddEstimada": 1.5, "confianca": 90, "justificativa": "motivo curto" }],
  "analiseJogos": [{ "jogo": "Time A x Time B", "escanteios": "média ~9.5, linha +8.5", "gols": "média 2.7 gols", "chutesAoGol": "Time A 5.2 / Time B 4.1", "cartoesTimes": "Time A 2.1 / Time B 1.8", "cartoesArbitro": "árbitro média 4.3 cartões/jogo" }],
  "observacoes": "texto curto"
}`;

    const { text } = await generateText({
      model: aiModel,
      system,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 6000,
    });

    const raw = parseAiJson(text);
    const rawPicks = Array.isArray(raw.picks) ? raw.picks : [];

    // Tabela de tradução de deep links
    const { data: templates } = await supabaseAdmin.from("deep_links").select("casa, mercado, url_template");

    const picks = rawPicks
      .map((item) => {
        const p = item as Record<string, unknown>;
        const jogo = toText(p.jogo ?? p.partida ?? p.confronto, "Jogo listado");
        const mercado = toText(p.mercado ?? p.market, "Resultado Final");
        const selecao = toText(p.selecao ?? p.palpite ?? p.selection, "Melhor seleção");

        // Casa o pick com a partida e odd reais do banco
        const partida = rows.find((r) => normKey(`${r.time_casa} x ${r.time_fora}`) === normKey(jogo));
        const oddRow = partida?.odds.find(
          (o) => normKey(o.casa) === normKey(data.casa) && normKey(o.selecao) === normKey(selecao),
        );
        const oddEstimada = oddRow ? oddRow.valor : toNumber(p.oddEstimada ?? p.odd, 1.5);

        const deepLink = buildDeepLink(
          (templates ?? []) as Array<{ casa: string; mercado: string | null; url_template: string }>,
          data.casa,
          jogo,
          { mercado, selecao },
          oddRow?.external_odd_id ?? null,
        );

        return {
          jogo,
          data: toText(p.data ?? p.horario, partida ? formatMatchDate(partida.inicio) : "Hoje"),
          mercado,
          selecao,
          oddEstimada,
          confianca: Math.max(0, Math.min(100, toNumber(p.confianca ?? p.confidence, 60))),
          justificativa: toText(p.justificativa ?? p.analise, "Escolha baseada nos jogos do banco."),
          deepLink,
          _partidaId: partida?.id,
        };
      })
      .filter((p) => p.confianca >= data.minConfianca);

    if (!picks.length) {
      throw new Error("Nenhuma entrada encontrada para esse filtro. Tente outro período ou campeonato.");
    }


    const oddTotal = picks.reduce((t, p) => t * p.oddEstimada, 1);

    // Jogos que aparecem em mais de uma seleção do bilhete (múltiplas opções no mesmo jogo)
    const contagemJogos = new Map<string, number>();
    for (const p of picks) contagemJogos.set(normKey(p.jogo), (contagemJogos.get(normKey(p.jogo)) ?? 0) + 1);
    const jogosMultiplos = new Set([...contagemJogos.entries()].filter(([, n]) => n > 1).map(([k]) => k));

    const rawAnalises = Array.isArray(raw.analiseJogos) ? raw.analiseJogos : [];
    const analiseJogos = rawAnalises
      .map((item) => {
        const a = item as Record<string, unknown>;
        return {
          jogo: toText(a.jogo ?? a.partida, ""),
          escanteios: toText(a.escanteios ?? a.corners, "Sem dados de escanteios."),
          gols: toText(a.gols ?? a.goals, "Sem dados de gols."),
          chutesAoGol: toText(a.chutesAoGol ?? a.chutes ?? a.shotsOnTarget, "Sem dados de chutes ao gol."),
          cartoesTimes: toText(a.cartoesTimes ?? a.cartoes, "Sem dados de cartões dos times."),
          cartoesArbitro: toText(a.cartoesArbitro ?? a.arbitro, "Sem dados do árbitro."),
        };
      })
      .filter((a) => a.jogo && jogosMultiplos.has(normKey(a.jogo)));

    // Verifica se a odd atingida ficou perto da odd alvo (±15%). Caso contrário,
    // gera resumo/observação honestos em vez de afirmar que bateu a meta.
    const desvio = Math.abs(oddTotal - data.oddAlvo) / data.oddAlvo;
    const dentroDaMargem = desvio <= 0.15;
    const oddFmt = oddTotal.toFixed(2);

    const resumoBase = dentroDaMargem
      ? `Aposta múltipla de ${picks.length} ${picks.length === 1 ? "seleção" : "seleções"} com odd total ${oddFmt}, dentro da margem de 15% da odd alvo (${data.oddAlvo}).`
      : `Não foi possível atingir a odd alvo (${data.oddAlvo}) com os jogos disponíveis: a melhor combinação possível chegou a ${oddFmt} com ${picks.length} ${picks.length === 1 ? "seleção" : "seleções"} de alta confiança. Amplie os campeonatos ou o período para alcançar odds maiores.`;

    const obsBase = toText(raw.observacoes ?? raw.notes, "Odds salvas no banco; podem variar até a confirmação na casa.");
    const observacoes = dentroDaMargem
      ? obsBase
      : `Odd alvo ${data.oddAlvo} não alcançável com o filtro atual (poucos jogos/mercados de alta confiança). ${obsBase}`;

    const ticket: Ticket = {
      resumo: resumoBase,
      analiseJogos,
      picks: picks.map((p) => ({
        jogo: p.jogo,
        data: p.data,
        mercado: p.mercado,
        selecao: p.selecao,
        oddEstimada: p.oddEstimada,
        confianca: p.confianca,
        justificativa: p.justificativa,
        deepLink: p.deepLink,
      })),
      oddTotal,
      risco: riskFromPicks(picks, oddTotal),
      observacoes,
    };


    const parsed = TicketSchema.safeParse(ticket);
    if (!parsed.success) {
      console.error("Bilhete inválido", parsed.error.flatten());
      throw new Error("A IA não retornou um bilhete válido. Tente novamente.");
    }

    // Persiste os palpites (best-effort) via service role
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const toInsert = picks
        .filter((p) => p._partidaId)
        .map((p) => ({
          partida_id: p._partidaId!,
          mercado: p.mercado,
          selecao: p.selecao,
          odd: p.oddEstimada,
          confianca: p.confianca,
          justificativa: p.justificativa,
          deep_link: p.deepLink ?? null,
        }));
      if (toInsert.length) await supabaseAdmin.from("palpites").insert(toInsert);
    } catch (e) {
      console.error("Falha ao salvar palpites", e);
    }

    return parsed.data;
  });
