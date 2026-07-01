import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type Plano } from "./planos";
import { analisarPartidas, diaSaoPaulo, type PartidaRow as AnalisePartidaRow } from "./analise.server";

const InputSchema = z.object({
  oddAlvo: z.number().min(1.1).max(1000),
  periodo: z.enum(["hoje", "amanha", "semana", "aovivo"]),
  campeonatos: z.array(z.string()).optional().default([]),
  mercados: z.array(z.string()).optional().default([]),
  casa: z.string().optional().default("Betano"),
  minConfianca: z.number().min(0).max(100).optional().default(90),
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

    // Gerar bilhete NÃO chama API-Football e NÃO depende de uma casa específica.
    // Usa qualquer odd já salva no banco (as odds são consenso e valem para
    // qualquer casa). Escolhe automaticamente a casa com mais jogos cobertos
    // apenas para ler as odds/análises — o bilhete serve para qualquer casa.
    const comOdds = rows.filter((r) => r.odds.length > 0);
    if (!comOdds.length) {
      throw new Error("Os jogos desse período ainda não têm odds salvas. Aguarde a sincronização automática configurada no painel.");
    }
    const cobertura = new Map<string, number>();
    for (const r of comOdds) {
      const casas = new Set(r.odds.map((o) => o.casa));
      for (const c of casas) cobertura.set(c, (cobertura.get(c) ?? 0) + 1);
    }
    const melhorCasa = [...cobertura.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (melhorCasa) data.casa = melhorCasa;
    rows = comOdds;

    // ---- Análise por jogo (somente cache) ----
    // A IA NÃO é chamada aqui. O robô (cron a cada 5 min) já analisou todos os
    // jogos e salvou em analise_cache. Aqui só lemos o que já está pronto.
    const dia = diaSaoPaulo(now);
    const aAnalisar = rows.slice(0, 40);
    const { resultado: analises } = await analisarPartidas(
      supabaseAdmin,
      null as never,
      aAnalisar as unknown as AnalisePartidaRow[],
      data.casa,
      dia,
      8,
      true, // somenteCache: nunca chama a IA no fluxo do cliente
    );

    // Se ainda não há análise salva para estes jogos, orienta a aguardar o robô.
    if (!analises.size) {
      throw new Error(
        "As análises destes jogos ainda estão sendo preparadas pelo robô. Aguarde alguns minutos e tente novamente.",
      );
    }

    const mercadoOk = (mercado: string, selecao: string) => {
      if (!data.mercados.length) return true;
      const alvo = normKey(`${mercado} ${selecao}`);
      return data.mercados.some((m) => alvo.includes(normKey(m)));
    };

    type Cand = {
      jogo: string;
      data: string;
      mercado: string;
      selecao: string;
      odd: number;
      confianca: number;
      justificativa: string;
      external_odd_id: string | null;
      _partidaId: string;
    };

    const porJogo = new Map<string, Cand[]>();
    for (const r of aAnalisar) {
      const a = analises.get(r.id);
      if (!a) continue;
      const jogo = `${r.time_casa} x ${r.time_fora}`;
      const lista: Cand[] = [];
      for (const p of a.picks) {
        if (!mercadoOk(p.mercado, p.selecao)) continue;
        if (p.confianca < data.minConfianca) continue;
        lista.push({
          jogo,
          data: formatMatchDate(r.inicio),
          mercado: p.mercado,
          selecao: p.selecao,
          odd: p.odd,
          confianca: p.confianca,
          justificativa: p.justificativa,
          external_odd_id: p.external_odd_id,
          _partidaId: r.id,
        });
      }
      if (lista.length) porJogo.set(r.id, lista.sort((x, y) => y.confianca - x.confianca));
    }

    if (!porJogo.size) {
      throw new Error("Nenhuma entrada encontrada para esse filtro. Tente outro período ou campeonato.");
    }

    // ---- Monta o bilhete (sem nova chamada de IA) para chegar o mais perto
    // possível da odd alvo. A cada passo escolhemos a seleção que aproxima o
    // produto atual da odd alvo. Assim odds alvo diferentes geram bilhetes
    // diferentes (antes alvos próximos, ex.: 4 e 5, caíam no mesmo bilhete). ----
    const target = data.oddAlvo;

    const candidatos: Cand[] = [];
    for (const lista of porJogo.values()) for (const p of lista) candidatos.push(p);

    const chosen: Cand[] = [];
    const usedMarket = new Set<string>();
    let prod = 1;
    const marketKey = (p: Cand) => `${p._partidaId}::${normKey(p.mercado)}`;
    const tryAdd = (p: Cand) => {
      const mk = marketKey(p);
      if (usedMarket.has(mk)) return false;
      chosen.push(p);
      usedMarket.add(mk);
      prod *= p.odd;
      return true;
    };

    // Passo a passo: adiciona a seleção que deixa o produto mais próximo da
    // odd alvo. Para quando nenhuma seleção conseguir aproximar mais.
    while (true) {
      const distAtual = Math.abs(target - prod);
      let melhor: Cand | null = null;
      let melhorDist = distAtual;
      for (const p of candidatos) {
        if (usedMarket.has(marketKey(p))) continue;
        const d = Math.abs(target - prod * p.odd);
        if (
          d < melhorDist - 1e-9 ||
          (Math.abs(d - melhorDist) <= 1e-9 && melhor && p.confianca > melhor.confianca)
        ) {
          melhor = p;
          melhorDist = d;
        }
      }
      if (!melhor) break;
      tryAdd(melhor);
    }

    // Garante pelo menos 1 seleção (odd alvo muito baixa).
    if (!chosen.length) {
      const all = [...candidatos].sort((a, b) => b.confianca - a.confianca);
      if (all[0]) tryAdd(all[0]);
    }

    // Tabela de tradução de deep links
    const { data: templates } = await supabaseAdmin.from("deep_links").select("casa, mercado, url_template");

    const picks = chosen.map((c) => ({
      jogo: c.jogo,
      data: c.data,
      mercado: c.mercado,
      selecao: c.selecao,
      oddEstimada: c.odd,
      confianca: c.confianca,
      justificativa: c.justificativa,
      deepLink: buildDeepLink(
        (templates ?? []) as Array<{ casa: string; mercado: string | null; url_template: string }>,
        data.casa,
        c.jogo,
        { mercado: c.mercado, selecao: c.selecao },
        c.external_odd_id,
      ),
      _partidaId: c._partidaId,
    }));

    if (!picks.length) {
      throw new Error("Nenhuma entrada encontrada para esse filtro. Tente outro período ou campeonato.");
    }

    const oddTotal = picks.reduce((t, p) => t * p.oddEstimada, 1);

    // Jogos com mais de uma seleção no bilhete recebem o bloco de estatísticas.
    const contagem = new Map<string, number>();
    for (const p of picks) contagem.set(p._partidaId, (contagem.get(p._partidaId) ?? 0) + 1);
    const multiplos = new Set([...contagem.entries()].filter(([, n]) => n > 1).map(([k]) => k));
    const analiseJogos = [...multiplos]
      .map((pid) => {
        const r = aAnalisar.find((x) => x.id === pid);
        const a = analises.get(pid);
        if (!r || !a) return null;
        return { jogo: `${r.time_casa} x ${r.time_fora}`, ...a.analise };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Verifica se a odd atingida ficou perto da odd alvo (±15%).
    const desvio = Math.abs(oddTotal - data.oddAlvo) / data.oddAlvo;
    const dentroDaMargem = desvio <= 0.15;
    const oddFmt = oddTotal.toFixed(2);

    const resumoBase = dentroDaMargem
      ? `Aposta múltipla de ${picks.length} ${picks.length === 1 ? "seleção" : "seleções"} com odd total ${oddFmt}, dentro da margem de 15% da odd alvo (${data.oddAlvo}).`
      : `Não foi possível atingir a odd alvo (${data.oddAlvo}) com os jogos disponíveis: a melhor combinação possível chegou a ${oddFmt} com ${picks.length} ${picks.length === 1 ? "seleção" : "seleções"} de alta confiança. Amplie os campeonatos ou o período para alcançar odds maiores.`;

    const observacoes = dentroDaMargem
      ? "Análises salvas do dia; as odds podem variar até a confirmação na casa."
      : `Odd alvo ${data.oddAlvo} não alcançável com o filtro atual (poucos jogos/mercados de alta confiança). Análises salvas do dia; as odds podem variar até a confirmação na casa.`;

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
