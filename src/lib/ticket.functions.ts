import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const InputSchema = z.object({
  oddAlvo: z.number().min(1.1).max(1000),
  periodo: z.enum(["hoje", "amanha", "semana", "aovivo"]),
  campeonatos: z.array(z.string()).optional().default([]),
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
});

const TicketSchema = z.object({
  resumo: z.string(),
  picks: z.array(PickSchema),
  oddTotal: z.number(),
  risco: z.enum(["baixo", "medio", "alto"]),
  observacoes: z.string(),
});

type Ticket = z.infer<typeof TicketSchema>;
type Periodo = z.infer<typeof InputSchema>["periodo"];

const FORBIDDEN_STATUS = /\b(FT|AET|PEN\.?|HT|AP|LIVE|AO VIVO|INTERVALO|ENCERRADO|FINALIZADO|FINISHED|POSTPONED|ADIADO|CANCELADO|SUSPENSO)\b/i;
const LIVE_MINUTE = /\b(?:\d{1,3}(?:\+\d{1,2})?'|1º|2º|1st|2nd)\b/i;
const SCORE_MARK = /\b\d{1,2}\s*(?:[-–]|x)\s*\d{1,2}\b|(?:^|\n)\s*\d{1,2}\s*(?:\n|$)/i;
const EXACT_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_HEADER = /^(\d{1,2})\/(\d{1,2})(?:\s+\S+)?$/;

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function compactText(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function pickAppearsInSource(pick: Ticket["picks"][number], source?: string) {
  if (!source) return true;
  const game = compactText(pick.jogo);
  const teams = game.split(/\s+x\s+|\s+vs\s+|\s+v\s+/).filter((team) => team.length >= 3);
  return source.split(/\n{2,}/).some((block) => {
    const normalizedBlock = compactText(block);
    return teams.length >= 2
      ? teams.slice(0, 2).every((team) => normalizedBlock.includes(team))
      : normalizedBlock.includes(game);
  });
}

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

function dateKey(date: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(date.year, date.month - 1, date.day) / 86400000);
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function extractTimeMinutes(text: string) {
  const match = text.match(/(?:^|\D)([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)(?:\D|$)/i);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function extractDate(text: string, now = new Date()) {
  const current = saoPauloParts(now);
  const normalized = normalizeText(text);
  if (normalized.includes("amanha") || normalized.includes("tomorrow")) return addDays(current, 1);
  if (normalized.includes("hoje") || normalized.includes("today")) return current;
  const match = text.match(/(?:^|\D)(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?:\D|$)/);
  if (!match) return null;
  const yearRaw = match[3] ? Number(match[3]) : current.year;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  return { year, month: Number(match[2]), day: Number(match[1]) };
}

function cleanMarkdownLine(line: string) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\/g, "")
    .trim();
}

function isPickDateAllowed(date: { year: number; month: number; day: number }, time: number, periodo: Periodo, now = new Date()) {
  const current = saoPauloParts(now);
  const pickKey = dateKey(date);
  const currentKey = dateKey(current);
  const currentMinutes = current.hour * 60 + current.minute;
  if (periodo === "hoje") return pickKey === currentKey && time > currentMinutes;
  if (periodo === "amanha") return pickKey === dateKey(addDays(current, 1));
  if (periodo === "semana") return pickKey > currentKey || (pickKey === currentKey && time > currentMinutes);
  return true;
}

function hasPastOrLiveMarker(text: string) {
  return FORBIDDEN_STATUS.test(text) || LIVE_MINUTE.test(text) || SCORE_MARK.test(text);
}

function isFuturePick(pick: Ticket["picks"][number], periodo: Periodo, now = new Date()) {
  const text = `${pick.data} ${pick.jogo}`;
  if (periodo === "aovivo") {
    // Em modo ao vivo, aceitamos jogos em andamento; rejeitamos apenas encerrados.
    if (/\b(FT|AET|PEN\.?|ENCERRADO|FINALIZADO|FULL[- ]?TIME)\b/i.test(text)) return false;
    return true;
  }
  if (hasPastOrLiveMarker(text)) return false;
  const current = saoPauloParts(now);
  const currentKey = dateKey(current);
  const currentMinutes = current.hour * 60 + current.minute;
  const time = extractTimeMinutes(text);
  const parsedDate = extractDate(pick.data, now);

  if (periodo === "hoje") {
    if (parsedDate && dateKey(parsedDate) !== currentKey) return false;
    return time !== null && time > currentMinutes;
  }

  if (periodo === "amanha") {
    const tomorrowKey = dateKey(addDays(current, 1));
    if (normalizeText(pick.data).includes("hoje")) return false;
    if (parsedDate && dateKey(parsedDate) !== tomorrowKey) return false;
    return time !== null;
  }

  if (parsedDate) {
    const pickKey = dateKey(parsedDate);
    if (pickKey < currentKey) return false;
    if (pickKey === currentKey) return time !== null && time > currentMinutes;
    return true;
  }
  return time !== null && time > currentMinutes;
}

const ESPN_LEAGUES = [
  { slug: "fifa.world", name: "Copa do Mundo" },
  { slug: "bra.1", name: "Brasileirão Série A" },
  { slug: "bra.2", name: "Brasileirão Série B" },
  { slug: "conmebol.libertadores", name: "Libertadores" },
  { slug: "conmebol.sudamericana", name: "Sul-Americana" },
  { slug: "eng.1", name: "Premier League" },
  { slug: "esp.1", name: "La Liga" },
  { slug: "ita.1", name: "Serie A (Itália)" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "fra.1", name: "Ligue 1" },
  { slug: "uefa.champions", name: "Champions League" },
  { slug: "uefa.europa", name: "Europa League" },
] as const;

function espnDateParam(date: { year: number; month: number; day: number }) {
  return `${date.year}${String(date.month).padStart(2, "0")}${String(date.day).padStart(2, "0")}`;
}

function periodDateParam(periodo: Periodo, now = new Date()) {
  const current = saoPauloParts(now);
  if (periodo === "amanha") return espnDateParam(addDays(current, 1));
  if (periodo === "semana") return `${espnDateParam(current)}-${espnDateParam(addDays(current, 7))}`;
  return espnDateParam(current);
}

function formatMatchDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function buildEspnMatches(payload: unknown, leagueName: string, periodo: Periodo, now = new Date()) {
  const events = Array.isArray((payload as { events?: unknown[] }).events) ? (payload as { events: unknown[] }).events : [];
  const current = saoPauloParts(now);
  const currentKey = dateKey(current);
  const tomorrowKey = dateKey(addDays(current, 1));

  return events.flatMap((event) => {
    const item = event as {
      date?: string;
      status?: { type?: { state?: string; completed?: boolean; description?: string } };
      competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: { displayName?: string } }> }>;
    };
    if (!item.date) return [];
    const state = item.status?.type?.state;
    const completed = item.status?.type?.completed;
    if (periodo === "aovivo") {
      if (state !== "in" || completed) return [];
    } else if (state !== "pre" || completed || new Date(item.date).getTime() <= now.getTime()) {
      return [];
    }

    const matchDate = saoPauloParts(new Date(item.date));
    const matchKey = dateKey(matchDate);
    if (periodo === "hoje" && matchKey !== currentKey) return [];
    if (periodo === "amanha" && matchKey !== tomorrowKey) return [];
    if (periodo === "semana" && (matchKey < currentKey || matchKey > dateKey(addDays(current, 7)))) return [];

    const competitors = item.competitions?.[0]?.competitors ?? [];
    const home = competitors.find((team) => team.homeAway === "home")?.team?.displayName;
    const away = competitors.find((team) => team.homeAway === "away")?.team?.displayName;
    if (!home || !away) return [];

    const status = item.status?.type?.description ?? (periodo === "aovivo" ? "Ao vivo" : "Agendado");
    return [`${formatMatchDate(item.date)}\n${home} x ${away}\nCampeonato: ${leagueName}\nStatus: ${status}`];
  });
}

async function fetchEspnUpcoming(periodo: Periodo, now = new Date()) {
  const dates = periodDateParam(periodo, now);
  const results = await Promise.allSettled(
    ESPN_LEAGUES.map(async (league) => {
      const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard`);
      url.searchParams.set("dates", dates);
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) return "";
      return buildEspnMatches(await response.json(), league.name, periodo, now).join("\n\n");
    }),
  );
  return results
    .map((result) => (result.status === "fulfilled" ? result.value : ""))
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);
}

function filterMarkdownToUpcoming(markdown: string, periodo: Periodo, now = new Date()) {
  if (periodo === "aovivo") {
    // Mantém somente blocos com marcador ao vivo (minuto em jogo) e descarta encerrados.
    return markdown
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => LIVE_MINUTE.test(b) && !/\b(FT|AET|PEN\.?|ENCERRADO|FINALIZADO)\b/i.test(b))
      .join("\n\n");
  }
  const current = saoPauloParts(now);
  let activeDate: { year: number; month: number; day: number } | null = null;
  let activeCompetition = "";
  const lines = markdown.split("\n").map(cleanMarkdownLine).filter(Boolean);
  const matches: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const dateMatch = line.match(DATE_HEADER);
    if (dateMatch) {
      activeDate = { year: current.year, month: Number(dateMatch[2]), day: Number(dateMatch[1]) };
      continue;
    }
    if (line.includes("Click for match detail")) {
      const status = lines[i + 1] ?? "";
      const timeMatch = status.match(EXACT_TIME);
      if (!timeMatch) continue;
      const time = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      const matchDate = activeDate ?? current;
      if (!isPickDateAllowed(matchDate, time, periodo, now)) continue;

      const teamLines = lines.slice(i + 2, i + 8).filter((value) => {
        if (!value || value === "--" || value.startsWith("_") || value.includes("Click for match detail")) return false;
        if (FORBIDDEN_STATUS.test(value) || SCORE_MARK.test(value)) return false;
        return !/(standings|preview|tv \/ live streaming|flashscore news|advertisement)/i.test(value);
      });
      if (teamLines.length < 2) continue;
      const dateText = `${String(matchDate.day).padStart(2, "0")}/${String(matchDate.month).padStart(2, "0")}/${matchDate.year}`;
      matches.push(`${dateText} ${status}\n${teamLines[0]} x ${teamLines[1]}${activeCompetition ? `\nCampeonato: ${activeCompetition}` : ""}`);
      continue;
    }
    if (/^[A-ZÀ-Ý][A-ZÀ-Ý\s.:-]+:$/.test(line)) {
      activeCompetition = line.replace(/:$/, "");
    } else if (/^[\wÀ-ÿ .'-]+$/.test(line) && !/^(All|LIVE|Odds|Finished|Scheduled|Standings)$/i.test(line)) {
      activeCompetition = line;
    }
  }

  return matches.join("\n\n");
}

function riskFromPicks(picks: Ticket["picks"], oddTotal: number): Ticket["risco"] {
  const avgConfidence = picks.length ? picks.reduce((sum, pick) => sum + pick.confianca, 0) / picks.length : 0;
  if (oddTotal >= 8 || avgConfidence < 55) return "alto";
  if (oddTotal <= 3 && avgConfidence >= 70) return "baixo";
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

function normalizeRisk(value: unknown): Ticket["risco"] {
  const risk = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (risk.includes("baixo") || risk.includes("low")) return "baixo";
  if (risk.includes("alto") || risk.includes("high")) return "alto";
  return "medio";
}

function extractJson(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON não encontrado");
  return cleaned.slice(start, end + 1);
}

function parseTicketFromText(text: string, oddAlvo: number, periodo: Periodo, now = new Date(), minConfianca = 0, source = ""): Ticket {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const rawPicks = Array.isArray(raw.picks) ? raw.picks : [];
  const picks = rawPicks.map((item) => {
    const pick = item as Record<string, unknown>;
    return {
      jogo: toText(pick.jogo ?? pick.partida ?? pick.confronto ?? pick.game, "Jogo listado"),
      data: toText(pick.data ?? pick.horario ?? pick.date, "Hoje"),
      mercado: toText(pick.mercado ?? pick.market, "Resultado Final"),
      selecao: toText(pick.selecao ?? pick.palpite ?? pick.selection, "Melhor seleção"),
      oddEstimada: toNumber(pick.oddEstimada ?? pick.odd_estimada ?? pick.odd ?? pick.odds, 1.5),
      confianca: Math.max(0, Math.min(100, toNumber(pick.confianca ?? pick.confidence, 60))),
      justificativa: toText(pick.justificativa ?? pick.analise ?? pick.reason, "Escolha baseada nos jogos encontrados."),
    };
  })
    .filter((pick) => pickAppearsInSource(pick, source))
    .filter((pick) => isFuturePick(pick, periodo, now))
    .filter((pick) => pick.confianca >= minConfianca);
  if (!picks.length) {
    throw new Error(
      periodo === "aovivo"
        ? `Nenhum jogo ao vivo agora com confiança >= ${minConfianca}%. Tente novamente em alguns minutos.`
        : "Não encontrei jogos futuros válidos nesse período. Tente amanhã ou escolha outro campeonato.",
    );
  }
  const calculatedOdd = picks.reduce((total, pick) => total * pick.oddEstimada, 1);
  const ticket = {
    resumo: toText(raw.resumo ?? raw.summary, `Bilhete montado buscando odd alvo ${oddAlvo}.`),
    picks,
    oddTotal: calculatedOdd,
    risco: riskFromPicks(picks, calculatedOdd),
    observacoes: toText(raw.observacoes ?? raw.notes, "Odds são estimativas e podem variar."),
  };

  const parsed = TicketSchema.safeParse(ticket);
  if (!parsed.success) {
    console.error("Invalid ticket JSON", parsed.error.flatten(), text.slice(0, 1000));
    throw new Error("A IA não retornou um bilhete válido. Tente gerar novamente.");
  }
  return parsed.data;
}

export const gerarBilhete = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const fcKey = process.env.FIRECRAWL_API_KEY;
    if (!fcKey) throw new Error("Missing FIRECRAWL_API_KEY");

    // 1. Buscar jogos do FlashScore via Firecrawl
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const firecrawl = new Firecrawl({ apiKey: fcKey });

    const urlMap: Record<typeof data.periodo, string> = {
      hoje: "https://www.flashscore.com/football/?d=0&mtg=scheduled",
      amanha: "https://www.flashscore.com/football/?d=1&mtg=scheduled",
      semana: "https://www.flashscore.com/football/?d=0&mtg=scheduled",
      aovivo: "https://www.flashscore.com/football/?mtg=live",
    };

    let jogosTexto = "";
    try {
      const scrape = await firecrawl.scrape(urlMap[data.periodo], {
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3000,
      });
      const md =
        (scrape as { markdown?: string }).markdown ??
        (scrape as { data?: { markdown?: string } }).data?.markdown ??
        "";
      jogosTexto = filterMarkdownToUpcoming(md, data.periodo).slice(0, 12000);
    } catch (err) {
      console.error("Firecrawl error", err);
      throw new Error("Não foi possível buscar os jogos agora. Tente novamente.");
    }

    if (!jogosTexto || jogosTexto.length < 200) {
      jogosTexto = await fetchEspnUpcoming(data.periodo);
    }

    if (!jogosTexto || jogosTexto.length < 80) {
      throw new Error(
        data.periodo === "aovivo"
          ? "Nenhum jogo ao vivo encontrado agora. Tente em alguns minutos."
          : "Não consegui extrair jogos. Tente outro período.",
      );
    }

    const gateway = createLovableAiGatewayProvider(key);

    const system = `Você é um analista esportivo de futebol especializado em apostas.
Receberá uma lista bruta (em markdown) de jogos de futebol agendados, extraída do FlashScore.
Selecione os melhores jogos e monte uma aposta múltipla (bilhete) cuja odd total combinada se aproxime o máximo possível da odd alvo informada.

Regras:
- Use SOMENTE jogos presentes na lista. Se a lista não tiver jogos claros, retorne picks vazio.
- CRÍTICO: NUNCA inclua jogos que JÁ ACONTECERAM ou estão AO VIVO. Apenas jogos AGENDADOS (futuros) cujo horário ainda não chegou.
- No FlashScore, jogos com placar visível (ex: "2 - 1"), status "FT", "Encerrado", "AET", "Pen.", "AP", ou minuto em andamento ("45'", "HT", "Intervalo") JÁ aconteceram ou estão ao vivo — IGNORE todos.
- Aceite apenas linhas que mostrem APENAS o horário do jogo (ex: "20:30", "15:00") sem placar.
- Identifique os confrontos, horários e competições a partir do markdown.
- Considere forma recente, mando de campo, confrontos diretos, lesões e contexto.
- Escolha mercados realistas (Resultado Final, Dupla Chance, Over/Under gols, Ambas Marcam, Handicap, Escanteios).
- A odd total combinada (multiplicação das odds individuais) deve ficar próxima da odd alvo (±15%).
- Não invente jogos nem confrontos que não estejam na lista.
- Confiança de 0 a 100. Risco: baixo, medio ou alto conforme odd total e confiança média.
- Justificativas curtas e diretas, em português.`;

    const periodoLabel = { hoje: "hoje", amanha: "amanhã", semana: "próximos dias", aovivo: "AO VIVO agora" }[data.periodo];
    const agora = new Date();
    const agoraStr = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short" });
    const campTxt = data.campeonatos && data.campeonatos.length
      ? `Campeonatos preferidos (use SOMENTE jogos destes campeonatos se houver suficientes): ${data.campeonatos.join(", ")}`
      : "Campeonatos: qualquer um disponível.";
    const prompt = `Data/hora atual (America/Sao_Paulo): ${agoraStr}
Período: ${periodoLabel}
Odd alvo da múltipla: ${data.oddAlvo}
${campTxt}

${data.periodo === "aovivo" ? "Jogos AO VIVO agora (markdown):" : "Jogos futuros filtrados do FlashScore (markdown):"}
${jogosTexto}

Selecione APENAS entradas com confiança >= 90%. Se nenhuma entrada atingir esse patamar, retorne picks vazio.
${data.periodo !== "aovivo" ? "LEMBRE: descarte qualquer jogo já encerrado, ao vivo, ou cujo horário já passou em relação à data/hora atual informada acima." : ""}`;

    const { text } = await generateText({
      model: gateway("google/gemini-3-flash-preview"),
      system,
      prompt: `${prompt}

Responda SOMENTE com JSON válido, sem markdown e sem texto fora do JSON, neste formato exato:
{
  "resumo": "texto curto",
  "picks": [{ "jogo": "Time A x Time B", "data": "horário/data", "mercado": "mercado", "selecao": "palpite", "oddEstimada": 1.5, "confianca": 90, "justificativa": "motivo curto" }],
  "oddTotal": 5.0,
  "risco": "baixo|medio|alto",
  "observacoes": "texto curto"
}`,
      temperature: 0.2,
      maxOutputTokens: 2500,
    });

    return parseTicketFromText(text, data.oddAlvo, data.periodo, agora, 90, jogosTexto);
  });