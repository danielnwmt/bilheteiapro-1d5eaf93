import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getAiModel } from "./ai-gateway.server";

const InputSchema = z.object({
  oddAlvo: z.number().min(1.1).max(1000),
  periodo: z.enum(["hoje", "amanha", "semana", "aovivo"]),
  campeonatos: z.array(z.string()).optional().default([]),
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

function normKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const aiModel = getAiModel();

    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const now = new Date();
    const { from, to } = periodRange(data.periodo, now);

    const lerPartidas = async () => {
      let query = supabase
        .from("partidas")
        .select("id, external_id, liga, time_casa, time_fora, inicio, status, odds(casa, mercado, selecao, valor, external_odd_id)")
        .gte("inicio", new Date(from).toISOString())
        .lte("inicio", new Date(to).toISOString())
        .order("inicio", { ascending: true })
        .limit(80);
      if (data.campeonatos.length) query = query.in("liga", data.campeonatos);
      return query;
    };

    let { data: partidas, error } = await lerPartidas();
    if (error) {
      console.error("Erro ao ler partidas", error);
      throw new Error("Não foi possível ler os jogos do banco. Tente novamente.");
    }

    // Sem jogos no banco: busca na API-Football e tenta de novo.
    if (!partidas?.length) {
      try {
        const { syncFixtures } = await import("./football.server");
        await syncFixtures(data.periodo);
        ({ data: partidas, error } = await lerPartidas());
      } catch (e) {
        console.error("Falha ao sincronizar com API-Football", e);
      }
    }

    let rows = (partidas ?? []) as PartidaRow[];
    if (!rows.length) {
      throw new Error(
        data.periodo === "aovivo"
          ? "Nenhum jogo ao vivo encontrado agora na API-Football."
          : "Nenhum jogo encontrado nesse período na API-Football.",
      );
    }

    // Busca odds reais na API-Football para os jogos sem odds da casa escolhida.
    const semOdds = rows.filter(
      (r) => !r.odds.some((o) => normKey(o.casa) === normKey(data.casa)),
    );
    if (semOdds.length) {
      try {
        const { syncOdds } = await import("./football.server");
        const gravadas = await syncOdds(
          semOdds.map((r) => ({
            id: r.id,
            external_id: r.external_id,
            time_casa: r.time_casa,
            time_fora: r.time_fora,
          })),
          data.casa,
        );
        if (gravadas > 0) {
          const recarregado = await lerPartidas();
          if (!recarregado.error && recarregado.data?.length) {
            rows = recarregado.data as PartidaRow[];
          }
        }
      } catch (e) {
        console.error("Falha ao sincronizar odds reais", e);
      }
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

    const gateway = createLovableAiGatewayProvider(key);

    const system = `Você é um analista esportivo de futebol especializado em apostas.
Receberá uma lista de jogos com odds reais disponíveis na casa "${data.casa}".
Monte uma aposta múltipla (bilhete) cuja odd total combinada se aproxime ao máximo da odd alvo informada.

Regras:
- Use SOMENTE jogos e mercados/seleções presentes na lista. Nunca invente.
- Quando houver odd listada para a seleção escolhida, use exatamente esse valor em oddEstimada.
- A multiplicação das odds individuais deve ficar a ±15% da odd alvo.
- Considere forma recente, mando de campo, confrontos diretos e contexto.
- Confiança de 0 a 100. Selecione APENAS entradas com confiança >= 90%.
- Justificativas curtas e diretas, em português.
- IMPORTANTE: quando houver MAIS DE UMA seleção no mesmo jogo, inclua esse jogo em "analiseJogos" com estimativas de: escanteios (média e linha provável), gols (média de gols na partida), chutes ao gol (média por time), média de cartões dos times e média de cartões do árbitro da partida. Cada campo deve ser curto (1 frase com números).`;

    const periodoLabel = { hoje: "hoje", amanha: "amanhã", semana: "próximos dias", aovivo: "AO VIVO agora" }[data.periodo];
    const prompt = `Período: ${periodoLabel}
Odd alvo da múltipla: ${data.oddAlvo}
Casa de aposta: ${data.casa}

Jogos disponíveis no banco:
${jogosTexto}

Selecione APENAS entradas com confiança >= 90%. Se nenhuma atingir, retorne picks vazio.

Responda SOMENTE com JSON válido neste formato:
{
  "resumo": "texto curto",
  "picks": [{ "jogo": "Time A x Time B", "data": "horário/data", "mercado": "mercado", "selecao": "palpite", "oddEstimada": 1.5, "confianca": 90, "justificativa": "motivo curto" }],
  "analiseJogos": [{ "jogo": "Time A x Time B", "escanteios": "média ~9.5, linha +8.5", "gols": "média 2.7 gols", "chutesAoGol": "Time A 5.2 / Time B 4.1", "cartoesTimes": "Time A 2.1 / Time B 1.8", "cartoesArbitro": "árbitro média 4.3 cartões/jogo" }],
  "observacoes": "texto curto"
}`;

    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 3500,
    });

    const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const rawPicks = Array.isArray(raw.picks) ? raw.picks : [];

    // Tabela de tradução de deep links
    const { data: templates } = await supabase.from("deep_links").select("casa, mercado, url_template");

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
      .filter((p) => p.confianca >= Math.max(90, data.minConfianca));

    if (!picks.length) {
      throw new Error("Nenhuma entrada com confiança >= 90% nesse período. Tente outro filtro.");
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

    const ticket: Ticket = {
      resumo: toText(raw.resumo ?? raw.summary, `Bilhete montado buscando odd alvo ${data.oddAlvo}.`),
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
      observacoes: toText(raw.observacoes ?? raw.notes, "Odds reais da API-Football; podem variar até a confirmação na casa."),
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
