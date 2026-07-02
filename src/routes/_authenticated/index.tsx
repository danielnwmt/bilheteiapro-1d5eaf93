import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { gerarBilhete, listarBilhetes, deletarBilhete, chanceRealDeAcerto, nivelDeRisco, rotuloRisco } from "@/lib/ticket.functions";
import { getMelhoresEntradas, type MelhorEntrada } from "@/lib/entradas.functions";
import { iniciarOperacao } from "@/lib/access.functions";
import { reanalisarJogo } from "@/lib/reanalise.functions";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Target, TrendingUp, Trophy, Building2, ExternalLink, ListChecks, LogOut, Lock, Crown, Users, Wallet, CalendarDays, UserCircle, Play, Flame, Zap, RefreshCw, Flag, CreditCard, LineChart, TrendingDown, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import logo from "@/assets/bilheteia-logo.png";
import { useAccess } from "@/hooks/useAccess";
import { ligaLiberada } from "@/lib/planos";
import { usePlanos } from "@/hooks/usePlanos";
import { AccentPicker } from "@/components/AccentPicker";
import { FloatingBrowser } from "@/components/FloatingBrowser";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "BilheteIA PRO — Análise de futebol e múltiplas com IA" },
      { name: "description", content: "Cole os jogos, defina a odd alvo e a IA monta a múltipla ideal com análise jogo a jogo." },
      { property: "og:title", content: "BilheteIA PRO — Múltiplas analisadas por IA" },
      { property: "og:description", content: "Análise de jogos de futebol e montagem automática de bilhetes." },
    ],
  }),
  component: Index,
});

type Ticket = {
  resumo: string;
  picks: Array<{
    jogo: string;
    data: string;
    mercado: string;
    selecao: string;
    oddEstimada: number;
    confianca: number;
    justificativa: string;
    deepLink?: string;
  }>;
  analiseJogos?: Array<{
    jogo: string;
    escanteios: string;
    gols: string;
    chutesAoGol: string;
    cartoesTimes: string;
    cartoesArbitro: string;
  }>;
  oddTotal: number;
  risco: "baixo" | "medio" | "alto";
  observacoes: string;
};

type JogoDia = {
  id: string;
  liga: string | null;
  time_casa: string;
  time_fora: string;
  inicio: string;
  status: string;
  arbitro?: string | null;
};

type EstatPayload = {
  formaCasa: string | null;
  formaFora: string | null;
  golsFeitosCasa: string | null;
  golsSofridosCasa: string | null;
  golsFeitosFora: string | null;
  golsSofridosFora: string | null;
  percent: { casa: string | null; empate: string | null; fora: string | null };
  golsPrev: { casa: string | null; fora: string | null };
  underOver: string | null;
  cartoesCasa: string | null;
  cartoesFora: string | null;
  cartoesConfronto: string | null;
  lesoesCasa?: string[] | null;
  lesoesFora?: string[] | null;
  escalacaoConfirmada?: boolean | null;
};

const CAMPEONATOS = [
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

const MERCADOS = [
  "Vitória / Resultado Final",
  "Dupla Chance",
  "Empate Anula (DNB)",
  "Ambas Marcam",
  "Mais/Menos Gols",
  "Escanteios",
  "Cartões",
  "Chutes ao Gol",
  "Handicap Asiático",
  "Placar Exato",
  "Gols no 1º Tempo",
  "Time Marca Gol",
];

const ADMIN_EMAIL = "contato@protenexus.com";

// Traduz termos em inglês que vêm da API (Over/Under, etc.) para português.
const PAISES: Record<string, string> = {
  "England": "Inglaterra",
  "Spain": "Espanha",
  "Germany": "Alemanha",
  "Italy": "Itália",
  "France": "França",
  "Netherlands": "Holanda",
  "Belgium": "Bélgica",
  "Portugal": "Portugal",
  "Croatia": "Croácia",
  "Switzerland": "Suíça",
  "Poland": "Polônia",
  "Denmark": "Dinamarca",
  "Sweden": "Suécia",
  "Norway": "Noruega",
  "Austria": "Áustria",
  "Scotland": "Escócia",
  "Wales": "País de Gales",
  "Ireland": "Irlanda",
  "Serbia": "Sérvia",
  "Turkey": "Turquia",
  "Greece": "Grécia",
  "Ukraine": "Ucrânia",
  "Czech Republic": "República Tcheca",
  "Czechia": "Tchéquia",
  "Russia": "Rússia",
  "Hungary": "Hungria",
  "Romania": "Romênia",
  "Finland": "Finlândia",
  "Iceland": "Islândia",
  "Slovakia": "Eslováquia",
  "Slovenia": "Eslovênia",
  "Argentina": "Argentina",
  "Brazil": "Brasil",
  "Uruguay": "Uruguai",
  "Colombia": "Colômbia",
  "Chile": "Chile",
  "Peru": "Peru",
  "Paraguay": "Paraguai",
  "Ecuador": "Equador",
  "Bolivia": "Bolívia",
  "Venezuela": "Venezuela",
  "Mexico": "México",
  "United States": "Estados Unidos",
  "USA": "EUA",
  "Canada": "Canadá",
  "Costa Rica": "Costa Rica",
  "Panama": "Panamá",
  "Honduras": "Honduras",
  "Japan": "Japão",
  "South Korea": "Coreia do Sul",
  "Korea Republic": "Coreia do Sul",
  "Australia": "Austrália",
  "Saudi Arabia": "Arábia Saudita",
  "Qatar": "Catar",
  "Iran": "Irã",
  "Iraq": "Iraque",
  "China": "China",
  "Morocco": "Marrocos",
  "Egypt": "Egito",
  "Nigeria": "Nigéria",
  "Senegal": "Senegal",
  "Cameroon": "Camarões",
  "Ghana": "Gana",
  "Ivory Coast": "Costa do Marfim",
  "Algeria": "Argélia",
  "Tunisia": "Tunísia",
  "South Africa": "África do Sul",
  "DR Congo": "RD Congo",
  "Bosnia & Herzegovina": "Bósnia e Herzegovina",
  "Bosnia and Herzegovina": "Bósnia e Herzegovina",
  "New Zealand": "Nova Zelândia",
};

function traduzPaises(texto: string): string {
  let out = texto;
  for (const [en, pt] of Object.entries(PAISES)) {
    out = out.replace(new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), pt);
  }
  return out;
}

// Normaliza nomes de time/jogo para comparar partidas iguais vindas de fontes
// diferentes (ex.: "DR Congo" x "Congo DR"): traduz, remove acentos, pontuação
// e ordena as palavras para não depender da ordem.
function normNome(s: string): string {
  return traduzPaises(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join("");
}


function traduzTermo(texto: string): string {
  if (!texto) return texto;
  return traduzPaises(texto)
    .replace(/\bOver\b/gi, "Mais de")
    .replace(/\bUnder\b/gi, "Menos de")
    .replace(/\bGoals?\b/gi, "Gols")
    .replace(/\bCorners?\b/gi, "Escanteios")
    .replace(/\bCards?\b/gi, "Cartões")
    .replace(/\bBoth Teams To Score\b/gi, "Ambas Marcam")
    .replace(/\bDraw\b/gi, "Empate")
    .replace(/\bHome\b/gi, "Casa")
    .replace(/\bAway\b/gi, "Fora")
    .replace(/\bYes\b/gi, "Sim")
    .replace(/\bNo\b/gi, "Não")
    .replace(/\bDouble Chance\b/gi, "Dupla Chance")
    .replace(/\bTotal Goals\b/gi, "Total de Gols")
    .replace(/\bTotals?\b/gi, "Total")
    .replace(/\bBoth Teams\b/gi, "Ambas as Equipes")
    .replace(/\bFirst Half\b/gi, "1º Tempo")
    .replace(/\bSecond Half\b/gi, "2º Tempo")
    .replace(/\bWinner\b/gi, "Vencedor")
    .replace(/\bMatch Winner\b/gi, "Resultado Final")
    // Remove número duplicado de handicap (ex.: "Casa +1.5 1.5 escanteios" -> "Casa +1.5 escanteios")
    .replace(/([+-]\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?/g, "$1");
}

// Gera uma sigla curta (3 letras) a partir do nome do time para os cards.
function sigla(nome: string): string {
  const n = traduzPaises(nome || "").trim();
  const palavras = n.split(/\s+/).filter((w) => w.length > 1);
  const base = palavras[0] || n;
  return base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase() || "—";
}



function Index() {
  const router = useRouter();
  const run = useServerFn(gerarBilhete);
  const fetchEntradas = useServerFn(getMelhoresEntradas);
  const iniciar = useServerFn(iniciarOperacao);
  const fetchSalvos = useServerFn(listarBilhetes);
  const removerBilhete = useServerFn(deletarBilhete);
  const [deletandoId, setDeletandoId] = useState<string | null>(null);
  const reanalisar = useServerFn(reanalisarJogo);
  const [reanalisandoId, setReanalisandoId] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const { data: access, refetch: refetchAccess } = useAccess();
  const [oddAlvo, setOddAlvo] = useState("5");
  const [valorAposta, setValorAposta] = useState("20");
  const [periodo, setPeriodo] = useState<"hoje" | "amanha" | "semana" | "aovivo">("hoje");
  
  const [campSel, setCampSel] = useState<string[]>([]);
  const [mercSel, setMercSel] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [salvos, setSalvos] = useState<Awaited<ReturnType<typeof listarBilhetes>>>([]);
  const [currentEmail, setCurrentEmail] = useState("");
  const [jogos, setJogos] = useState<JogoDia[]>([]);
  const [loadingJogos, setLoadingJogos] = useState(false);
  const [janela, setJanela] = useState<{ url: string; title: string } | null>(null);
  const [entradas, setEntradas] = useState<MelhorEntrada[]>([]);
  const [loadingEntradas, setLoadingEntradas] = useState(false);
  const [avisoOperacao, setAvisoOperacao] = useState<{
    tipo: "ok" | "warning";
    texto: string;
    etapas?: Array<{ etapa: string; ok: boolean; info: string }>;
  } | null>(null);
  const [estatJogo, setEstatJogo] = useState<JogoDia | null>(null);
  const [estatPayload, setEstatPayload] = useState<EstatPayload | null>(null);
  const [estatEscanteios, setEstatEscanteios] = useState<string | null>(null);
  const [loadingEstat, setLoadingEstat] = useState(false);
  const [statsMap, setStatsMap] = useState<Record<string, { pc: number; pe: number; pf: number }>>({});
  const [oddMin, setOddMin] = useState("2.5");
  const [limiteJogos, setLimiteJogos] = useState("4");
  const [tipoBilhete, setTipoBilhete] = useState<"simples" | "multipla" | "mesmojogo">("multipla");



  async function abrirEstatisticas(j: JogoDia) {
    setEstatJogo(j);
    setEstatPayload(null);
    setEstatEscanteios(null);
    setLoadingEstat(true);
    try {
      const [{ data }, { data: cache }] = await Promise.all([
        supabase
          .from("estatisticas")
          .select("payload")
          .eq("partida_id", j.id)
          .eq("tipo", "predicoes")
          .maybeSingle(),
        supabase
          .from("analise_cache")
          .select("payload")
          .eq("partida_id", j.id)
          .limit(1)
          .maybeSingle(),
      ]);
      setEstatPayload((data?.payload ?? null) as EstatPayload | null);
      const esc = (cache?.payload as { analise?: { escanteios?: string } } | null)?.analise?.escanteios;
      setEstatEscanteios(esc ?? null);
    } catch (err) {
      console.error(err);
      setEstatPayload(null);
      setEstatEscanteios(null);
    } finally {
      setLoadingEstat(false);
    }
  }

  // Simulação de "Escalações Confirmadas": um jogo é tratado como escalação
  // oficial quando começa nos próximos 60 min (ou já está ao vivo). Nesse
  // estado exibimos o selo "Escalação Oficial" e liberamos a reanálise.
  function escalacaoConfirmada(j: JogoDia): boolean {
    if (j.status === "ao_vivo") return true;
    const faltaMin = (new Date(j.inicio).getTime() - Date.now()) / 60000;
    return faltaMin > 0 && faltaMin <= 60;
  }

  // Limpa o cache e força a IA a reanalisar aquele jogo com base na escalação.
  async function handleReanalisar(j: JogoDia) {
    setReanalisandoId(j.id);
    toast.info(`Escalação confirmada: limpando cache e reanalisando ${traduzPaises(j.time_casa)} x ${traduzPaises(j.time_fora)}...`);
    try {
      const r = await reanalisar({ data: { partidaId: j.id } });
      if (r.ok && r.reanalisado) {
        toast.success(`Reanálise concluída com base nos jogadores em campo (${r.picks} entradas).`);
      } else {
        toast.warning(r.motivo ?? "Reanálise concluída, mas sem novas entradas.");
      }
      if (estatJogo?.id === j.id) abrirEstatisticas(j);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reanalisar o jogo.");
    } finally {
      setReanalisandoId(null);
    }
  }



  const { byPlano } = usePlanos();
  const roles = access?.roles ?? [];
  const isAdmin = access?.isAdmin ?? (roles.includes("admin") || currentEmail === ADMIN_EMAIL);
  const isStaff = access?.isStaff ?? (isAdmin || roles.includes("operador"));
  const plano = access?.plano ?? null;
  const planoCfg = plano ? byPlano?.[plano] ?? null : null;
  const temAcesso = isStaff || !!plano;
  const permiteAoVivo = isStaff || !!planoCfg?.recursos?.tempoReal;

  // Volta do checkout: atualiza o plano.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
    });

    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast.success("Pagamento recebido! Atualizando seu plano...");
      setTimeout(() => refetchAccess(), 1500);
      window.history.replaceState({}, "", "/");
    }
  }, [refetchAccess]);

  // Carrega os jogos do período direto do banco.
  useEffect(() => {
    let ativo = true;
    async function carregar() {
      setLoadingJogos(true);
      try {
        let q = supabase
          .from("partidas")
          .select("id, liga, time_casa, time_fora, inicio, status, arbitro")
          .in("liga", CAMPEONATOS)
          .order("inicio", { ascending: true });

        if (periodo === "aovivo") {
          // Um jogo só é considerado realmente "ao vivo" se começou nas
          // últimas ~3,5h (evita jogos com status desatualizado/encerrado).
          const janelaInicio = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();
          q = q
            .eq("status", "ao_vivo")
            .gte("inicio", janelaInicio)
            .lte("inicio", new Date().toISOString());
        } else {
          const spDate = (offset: number) => {
            const d = new Date();
            d.setUTCDate(d.getUTCDate() + offset);
            return new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/Sao_Paulo",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(d);
          };
          const endOffset = periodo === "semana" ? 7 : periodo === "amanha" ? 1 : 0;
          // Mantém visíveis os jogos que começaram há pouco (em andamento),
          // evitando que somem da lista assim que dá o horário de início.
          const agoraMenos = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();
          const startBound =
            periodo === "amanha"
              ? `${spDate(1)}T00:00:00-03:00`
              : agoraMenos;
          q = q
            .gte("inicio", startBound)
            .lte("inicio", `${spDate(endOffset)}T23:59:59-03:00`)
            .neq("status", "encerrado");

        }

        const { data, error } = await q.limit(200);
        if (error) throw error;
        if (ativo) setJogos((data ?? []) as JogoDia[]);
      } catch (err) {
        console.error(err);
        if (ativo) setJogos([]);
      } finally {
        if (ativo) setLoadingJogos(false);
      }
    }
    carregar();
    return () => {
      ativo = false;
    };
  }, [periodo]);

  // Carrega as melhores entradas já analisadas pelo robô.
  useEffect(() => {
    if (!temAcesso) return;
    let ativo = true;
    setLoadingEntradas(true);
    fetchEntradas()
      .then((r) => {
        if (ativo) setEntradas(r.entradas ?? []);
      })
      .catch(() => {
        if (ativo) setEntradas([]);
      })
      .finally(() => {
        if (ativo) setLoadingEntradas(false);
      });
    return () => {
      ativo = false;
    };
  }, [temAcesso, fetchEntradas]);

  // Carrega as probabilidades (1X2) de todos os jogos visíveis num só lote para
  // desenhar as barras de probabilidade nos cards.
  useEffect(() => {
    let ativo = true;
    const ids = jogos.map((j) => j.id);
    if (ids.length === 0) {
      setStatsMap({});
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("estatisticas")
          .select("partida_id, payload")
          .eq("tipo", "predicoes")
          .in("partida_id", ids);
        if (!ativo) return;
        const pnum = (v: unknown) => {
          const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
          return Number.isFinite(n) ? n : 0;
        };
        const map: Record<string, { pc: number; pe: number; pf: number }> = {};
        for (const row of data ?? []) {
          const p = (row as { payload?: unknown }).payload as EstatPayload | undefined;
          if (!p) continue;
          map[(row as { partida_id: string }).partida_id] = {
            pc: pnum(p.percent?.casa),
            pe: pnum(p.percent?.empate),
            pf: pnum(p.percent?.fora),
          };
        }
        setStatsMap(map);
      } catch {
        if (ativo) setStatsMap({});
      }
    })();
    return () => {
      ativo = false;
    };
  }, [jogos]);



  function carregarSalvos() {
    fetchSalvos()
      .then((r) => setSalvos(r ?? []))
      .catch(() => {});
  }

  async function handleDeletarBilhete(id: string) {
    setDeletandoId(id);
    try {
      await removerBilhete({ data: { id } });
      setSalvos((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      console.error("Falha ao deletar bilhete", e);
    } finally {
      setDeletandoId(null);
    }
  }

  useEffect(() => {
    if (!temAcesso) return;
    carregarSalvos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temAcesso]);

  function podeUsarLiga(c: string) {
    return isStaff || ligaLiberada(planoCfg, c);
  }



  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }



  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const odd = parseFloat(oddAlvo);
    if (!odd) {
      toast.error("Defina a odd alvo");
      return;
    }
    setLoading(true);
    setTicket(null);
    try {
      const r = await run({ data: { oddAlvo: odd, periodo, campeonatos: campSel, mercados: mercSel } });
      setTicket(r);
      carregarSalvos();
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar bilhete.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleIniciarOperacao() {
    setIniciando(true);
    setAvisoOperacao(null);
    toast.info("Iniciando operação: buscando jogos, odds e análises...");
    try {
      const r = await iniciar();
      for (const etapa of r.etapas) {
        if (etapa.ok) toast.success(`${etapa.etapa}: ${etapa.info}`);
        else toast.error(`${etapa.etapa}: ${etapa.info}`);
      }
      if (r.ok) {
        toast.success("Operação concluída! Já pode gerar bilhetes.");
        setAvisoOperacao({
          tipo: "ok",
          texto: "Operação concluída! Já pode gerar bilhetes.",
          etapas: r.etapas,
        });
      } else {
        toast.warning("Operação concluída com avisos. Veja o detalhe de cada etapa abaixo.");
        setAvisoOperacao({
          tipo: "warning",
          texto: "Operação concluída com avisos. Veja o detalhe de cada etapa abaixo.",
          etapas: r.etapas,
        });
      }
      // Recarrega as melhores entradas e avisa quando a IA termina de analisar.
      setLoadingEntradas(true);
      try {
        const res = await fetchEntradas();
        const lista = res.entradas ?? [];
        setEntradas(lista);
        if (lista.length > 0) {
          toast.success(`A IA terminou de analisar os jogos — ${lista.length} entradas encontradas.`);
          setAvisoOperacao((prev) => ({
            tipo: "ok",
            texto: `A IA terminou de analisar os jogos. ${lista.length} melhores entradas disponíveis abaixo.`,
            etapas: prev?.etapas,
          }));
        }
      } catch {
        /* mantém o aviso anterior */
      } finally {
        setLoadingEntradas(false);
      }
    } catch (err: unknown) {
      console.error(err);
      let msg = err instanceof Error ? err.message : "Erro ao iniciar a operação.";
      // Evita vazar HTML de erros de gateway (ex.: "504 Gateway Time-out").
      if (/<html|<!doctype|gateway time-?out/i.test(msg)) {
        msg = "O servidor demorou demais para responder. Tente novamente em instantes.";
      }
      toast.error(msg);
      setAvisoOperacao({ tipo: "warning", texto: msg });
    } finally {
      setIniciando(false);
    }
  }




  // Chance real de acerto = probabilidade implícita combinada (produto de 1/odd).
  const chancePctNum =
    ticket && ticket.picks.length
      ? chanceRealDeAcerto(ticket.picks.map((p) => Number(p.oddEstimada) || 0))
      : 0;
  const chancePct = chancePctNum.toFixed(2);

  // Faixa de cor/aviso conforme a chance real: <10% alto, 10-30% médio, >30% baixo.
  const chanceRisco = nivelDeRisco(chancePctNum);
  const chanceRiscoLabel = rotuloRisco(chancePctNum);

  const chanceColor = {
    baixo: "bg-primary/20 text-primary border-primary/30",
    medio: "bg-accent/20 text-accent border-accent/30",
    alto: "bg-destructive/20 text-destructive border-destructive/30",
  } as const;

  const chanceAviso = {
    baixo: "Chance real de acerto boa: probabilidade combinada favorável para essa odd.",
    medio: "Chance real de acerto média: combinação equilibrada, com a incerteza natural das apostas.",
    alto: "Chance real de acerto baixa: quanto maior a odd, mais jogos precisam acertar juntos — aposte com cautela.",
  } as const;


  const jogosFiltrados = (() => {
    const vistos = new Set<string>();
    return jogos.filter((j) => {
      if (campSel.length > 0 && !(j.liga ? campSel.includes(j.liga) : false)) return false;
      // Evita jogos duplicados (fontes diferentes criam 2 linhas do mesmo jogo).
      // Agrupa o horário por hora para tolerar pequenas diferenças entre fontes.
      const hora = Math.round(new Date(j.inicio).getTime() / (60 * 60 * 1000));
      const dupla = [normNome(j.time_casa), normNome(j.time_fora)].sort().join("|");
      const chave = `${dupla}|${hora}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
  })();

  // Remove entradas duplicadas do mesmo jogo/mercado/seleção (mesma partida
  // vinda de fontes diferentes gera linhas repetidas). Mantém a de maior odd.
  const entradasFiltradas = (() => {
    const melhor = new Map<string, MelhorEntrada>();
    for (const e of entradas) {
      const hora = Math.round(new Date(e.inicio).getTime() / (60 * 60 * 1000));
      const chave = `${normNome(e.jogo)}|${hora}|${normNome(e.mercado)}|${normNome(e.selecao)}`;
      const atual = melhor.get(chave);
      if (!atual || e.odd > atual.odd) melhor.set(chave, e);
    }
    return Array.from(melhor.values());
  })();

  const premioPotencial = ticket ? (parseFloat(valorAposta) || 0) * ticket.oddTotal : 0;



  function toggleCamp(c: string) {
    if (!podeUsarLiga(c)) {
      toast.error("Este campeonato não está no seu plano.");
      router.navigate({ to: "/planos" });
      return;
    }
    setCampSel((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function toggleMerc(m: string) {
    setMercSel((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10 md:py-16">
        <header className="mb-10">
          <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
            {plano && (
              <Badge variant="secondary" className="mr-auto">
                <Crown className="mr-1 h-3.5 w-3.5" /> {planoCfg?.nome ?? "Plano ativo"}
              </Badge>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
                <Users className="mr-2 h-4 w-4" /> Admin
              </Button>
            )}

            <AccentPicker compact />
            {(isStaff || !!planoCfg?.recursos?.planilhaBanca) && (
              <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/banca" })}>
                <Wallet className="mr-2 h-4 w-4" /> Banca
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/perfil" })}>
              <UserCircle className="mr-2 h-4 w-4" /> Perfil
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/planos" })}>
              <Crown className="mr-2 h-4 w-4" /> Planos
            </Button>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </Button>
          </div>
          <div className="text-center">
            <img src={logo} alt="BilheteIA PRO" className="mx-auto mb-4 w-64 max-w-full md:w-80" />
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Pare de perder tempo analisando jogos. A IA encontra as melhores combinações para você em segundos.
            </p>
          </div>
        </header>

        {!temAcesso && (
          <Card className="mb-8 border-primary/40 bg-primary/5 p-6 text-center">
            <Lock className="mx-auto mb-3 h-8 w-8 text-primary" />
            <h2 className="text-lg font-bold">Assine um plano para gerar bilhetes</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Escolha entre Start, Pro e Elite e libere as ligas e recursos do seu plano.
            </p>
            <Button className="mt-4 font-semibold" onClick={() => router.navigate({ to: "/planos" })}>
              Ver planos
            </Button>
          </Card>
        )}

        {/* Cabeçalho: título + filtros de campeonato */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {periodo === "aovivo"
                ? "Jogos ao vivo"
                : periodo === "amanha"
                ? "Jogos de amanhã"
                : periodo === "semana"
                ? "Jogos da semana"
                : "Jogos do dia"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Análises geradas por IA · probabilidades, gols esperados e mercados com valor.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCampSel([])}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                campSel.length === 0
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              Todos
            </button>
            {CAMPEONATOS.map((c) => {
              const active = campSel.includes(c);
              const liberado = podeUsarLiga(c);
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => toggleCamp(c)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                  } ${liberado ? "" : "opacity-50"}`}
                >
                  {!liberado && <Lock className="h-3 w-3" />}
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* Grid de jogos */}
          <div>
            {loadingJogos ? (
              <div className="flex items-center justify-center rounded-xl border border-border/60 bg-card py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando jogos...
              </div>
            ) : jogosFiltrados.length === 0 ? (
              <div className="rounded-xl border border-border/60 bg-card py-16 text-center text-sm text-muted-foreground">
                Nenhum jogo encontrado para este período. Os jogos são atualizados automaticamente.
              </div>
            ) : (
              <div className="grid content-start gap-4 sm:grid-cols-2">
                {jogosFiltrados.map((j) => {
                  const st = statsMap[j.id];
                  const soma = st ? (st.pc + st.pe + st.pf) || 1 : 1;
                  const confAlta = !!st && (st.pc >= 55 || st.pf >= 55);
                  const oficial = escalacaoConfirmada(j);
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => abrirEstatisticas(j)}
                      className="group flex flex-col rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-primary/50"
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Trophy className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{j.liga ?? "—"}</span>
                        </span>
                        <span className="shrink-0 font-medium text-foreground/80">
                          {j.status === "ao_vivo"
                            ? "🔴 AO VIVO"
                            : new Date(j.inicio).toLocaleTimeString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-2xl font-bold leading-none">{sigla(j.time_casa)}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{traduzPaises(j.time_casa)}</p>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">vs</span>
                        <div className="min-w-0 flex-1 text-right">
                          <p className="text-2xl font-bold leading-none">{sigla(j.time_fora)}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{traduzPaises(j.time_fora)}</p>
                        </div>
                      </div>

                      {st ? (
                        <>
                          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="bg-primary" style={{ width: `${(st.pc / soma) * 100}%` }} />
                            <div className="bg-muted-foreground/40" style={{ width: `${(st.pe / soma) * 100}%` }} />
                            <div className="bg-sky-500" style={{ width: `${(st.pf / soma) * 100}%` }} />
                          </div>
                          <div className="mt-1.5 flex justify-between text-[11px] font-medium">
                            <span className="text-primary">1 · {st.pc}%</span>
                            <span className="text-muted-foreground">X · {st.pe}%</span>
                            <span className="text-sky-500">2 · {st.pf}%</span>
                          </div>
                        </>
                      ) : (
                        <div className="mt-4 h-1.5 rounded-full bg-muted" />
                      )}

                      <div className="mt-3 flex items-center justify-between">
                        {st ? (
                          <Badge
                            className={`gap-1 border text-[11px] ${
                              confAlta
                                ? "border-primary/30 bg-primary/15 text-primary"
                                : "border-amber-500/30 bg-amber-500/15 text-amber-500"
                            }`}
                          >
                            <Sparkles className="h-3 w-3" /> {confAlta ? "IA Alta" : "IA Média"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            Análise pendente
                          </Badge>
                        )}
                        <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                          Ver análise <TrendingUp className="h-3.5 w-3.5" />
                        </span>
                      </div>

                      {oficial && (
                        <Badge variant="secondary" className="mt-2 h-4 w-fit gap-0.5 px-1.5 text-[10px] text-primary">
                          <Zap className="h-2.5 w-2.5" /> Escalação Oficial
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Criador de Bilhetes */}
          <Card className="h-fit border-primary/30 bg-card p-6 lg:sticky lg:top-6">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Zap className="h-5 w-5 text-primary" /> Criador de Bilhetes
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A IA seleciona mercados com valor esperado positivo.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-xs font-semibold">
              {([
                { id: "simples", label: "Simples" },
                { id: "multipla", label: "Múltipla" },
                { id: "mesmojogo", label: "Mesmo Jogo" },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTipoBilhete(t.id)}
                  className={`rounded-md py-1.5 transition-colors ${
                    tipoBilhete === t.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="oddMin" className="mb-1.5 block text-xs">Odd mínima</Label>
                <Input
                  id="oddMin"
                  type="number"
                  step="0.1"
                  min="1.1"
                  value={oddMin}
                  onChange={(e) => setOddMin(e.target.value)}
                  className="bg-input/40"
                />
              </div>
              <div>
                <Label htmlFor="oddMax" className="mb-1.5 block text-xs">Odd máxima (alvo)</Label>
                <Input
                  id="oddMax"
                  type="number"
                  step="0.1"
                  min="1.1"
                  value={oddAlvo}
                  onChange={(e) => setOddAlvo(e.target.value)}
                  className="bg-input/40"
                />
              </div>
            </div>

            <div className="mt-3">
              <Label htmlFor="limite" className="mb-1.5 block text-xs">Limite de jogos por bilhete</Label>
              <Input
                id="limite"
                type="number"
                min="1"
                max="12"
                value={limiteJogos}
                onChange={(e) => setLimiteJogos(e.target.value)}
                className="bg-input/40"
              />
            </div>

            <div className="mt-4">
              <Label className="mb-1.5 block text-xs">Período</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["aovivo", "hoje", "amanha", "semana"] as const).map((p) => {
                  const bloqueado = p === "aovivo" && !permiteAoVivo;
                  return (
                    <button
                      type="button"
                      key={p}
                      onClick={() => {
                        if (bloqueado) {
                          toast.error("Atualização em tempo real não está no seu plano.");
                          router.navigate({ to: "/planos" });
                          return;
                        }
                        setPeriodo(p);
                      }}
                      className={`flex items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                        periodo === p
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                      } ${bloqueado ? "opacity-50" : ""}`}
                    >
                      {bloqueado && <Lock className="h-3 w-3" />}
                      {p === "amanha" ? "amanhã" : p === "aovivo" ? "🔴 ao vivo" : p}
                    </button>
                  );
                })}
              </div>
            </div>

            <details className="mt-4 rounded-md border border-border/60 bg-input/20 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Mercados do bilhete {mercSel.length > 0 && `(${mercSel.length})`}
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {MERCADOS.map((m) => {
                  const active = mercSel.includes(m);
                  return (
                    <button
                      type="button"
                      key={m}
                      onClick={() => toggleMerc(m)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Deixe vazio para a IA usar qualquer mercado.</p>
            </details>

            <p className="mt-3 text-center text-[11px] text-primary">Todas as entradas exigem confiança ≥ 90%.</p>

            <Button
              type="button"
              onClick={() => onSubmit()}
              disabled={loading || !temAcesso}
              size="lg"
              className="mt-3 w-full font-semibold"
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analisando...</>
              ) : !temAcesso ? (
                <><Lock className="mr-2 h-4 w-4" /> Assine um plano</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> Gerar bilhete</>
              )}
            </Button>
          </Card>
        </div>

        {/* Melhores entradas analisadas pela IA */}
        {temAcesso && (
          <Card className="border-primary/30 bg-card p-6 md:p-8">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Flame className="h-5 w-5 text-primary" /> Melhores entradas
              </h2>
              {!loadingEntradas && entradasFiltradas.length > 0 && (
                <Badge variant="secondary">{entradasFiltradas.length}</Badge>
              )}
            </div>

            {avisoOperacao && (
              <div
                className={`mb-4 rounded-md border p-3 text-xs ${
                  avisoOperacao.tipo === "ok"
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-accent/40 bg-accent/10 text-accent-foreground"
                }`}
              >
                <div className="flex items-start gap-2">
                  {avisoOperacao.tipo === "ok" ? (
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>{avisoOperacao.texto}</span>
                </div>
                {avisoOperacao.etapas && avisoOperacao.etapas.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-current/20 pt-2">
                    {avisoOperacao.etapas.map((et) => (
                      <li key={et.etapa} className="flex items-start gap-1.5">
                        <span className="shrink-0">{et.ok ? "✅" : "⚠️"}</span>
                        <span>
                          <span className="font-semibold">{et.etapa}:</span> {et.info}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {loadingEntradas ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
              </div>
            ) : entradasFiltradas.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                As melhores entradas analisadas pela IA aparecem aqui. Aguarde a análise automática.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {entradasFiltradas.map((e, i) => (
                  <div key={`${e.jogo}-${i}`} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{traduzPaises(e.jogo)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {e.liga ?? "—"} ·{" "}
                          {new Date(e.inicio).toLocaleTimeString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <span className="shrink-0 font-display text-base font-bold text-primary">
                        {e.odd.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-primary">{traduzTermo(e.selecao)}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{traduzTermo(e.mercado)}</p>
                      </div>
                      <Badge className="shrink-0 border border-primary/30 bg-primary/15 text-[10px] text-primary">
                        {e.confianca}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}





        {ticket && (
          <Card className="order-first overflow-hidden border-primary/30 bg-card">
            <div className="border-b border-border/60 bg-primary/5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Bilhete sugerido
                  </p>
                  <h2 className="mt-1 text-2xl font-bold">
                    Odd total: <span className="text-primary">{ticket.oddTotal.toFixed(2)}</span>
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`${chanceColor[chanceRisco]} border px-3 py-1 text-xs`}>
                    Chance real de acerto: {chancePct}%
                  </Badge>
                  <Badge className={`${chanceColor[chanceRisco]} border px-3 py-1 text-xs uppercase`}>
                    {chanceRiscoLabel}
                  </Badge>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{ticket.resumo}</p>
              <div className={`mt-3 rounded-lg border p-3 text-sm ${chanceColor[chanceRisco]}`}>
                {chanceAviso[chanceRisco]}
              </div>

            </div>

            <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
              <div className="divide-y divide-border/60">
                {ticket.picks.map((p, i) => (
                  <div key={i} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{p.data}</span>
                          <span>·</span>
                          <span className="font-medium text-foreground/80">{traduzTermo(p.mercado)}</span>
                        </div>
                        <h3 className="mt-1 text-base font-semibold">{traduzPaises(p.jogo)}</h3>
                        <p className="mt-1 text-primary font-medium">{traduzTermo(p.selecao)}</p>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-2xl font-bold text-primary">
                          {p.oddEstimada.toFixed(2)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.confianca}% conf.
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{p.justificativa}</p>
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setJanela({
                            url: p.deepLink ?? `https://www.google.com/search?q=${encodeURIComponent(`${p.jogo} odds aposta`)}`,
                            title: p.jogo,
                          })
                        }
                      >
                        Abrir jogo <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <aside className="border-t border-border/60 bg-muted/20 p-4 lg:border-l lg:border-t-0">
                <div className="rounded-md border border-border bg-card p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="inline-flex rounded-full bg-muted p-1 text-[11px] font-semibold">
                      <span className="rounded-full bg-primary px-3 py-1 text-primary-foreground">Múltipla</span>
                      <span className="px-3 py-1 text-muted-foreground">Sistema</span>
                    </div>
                    <Badge variant="secondary">{ticket.picks.length}</Badge>
                  </div>

                  <div className="space-y-2">
                    {Object.values(
                      ticket.picks.reduce(
                        (acc, p) => {
                          (acc[p.jogo] ??= { jogo: p.jogo, data: p.data, picks: [] }).picks.push(p);
                          return acc;
                        },
                        {} as Record<string, { jogo: string; data: string; picks: typeof ticket.picks }>,
                      ),
                    ).map((grupo, gi) => {
                      const oddGrupo = grupo.picks.reduce((t, p) => t * p.oddEstimada, 1);
                      return (
                        <div key={`${grupo.jogo}-${gi}`} className="rounded-md border border-border/70 bg-muted/30 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold">{traduzPaises(grupo.jogo)}</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">{grupo.data}</p>
                            </div>
                            <span className="text-xs font-bold text-primary">{oddGrupo.toFixed(2)}</span>
                          </div>
                          <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
                            {grupo.picks.map((p, pi) => (
                              <div key={`${p.selecao}-${pi}`} className="flex items-end justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold">{traduzTermo(p.selecao)}</p>
                                  <p className="text-[10px] text-muted-foreground">{traduzTermo(p.mercado)}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[11px] font-bold text-primary">{p.oddEstimada.toFixed(2)}</p>
                                  <p className="text-[10px] font-semibold text-primary">{p.confianca}%</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase text-primary">Supermúltipla</p>
                      <span className="text-lg">🙂</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Bilhete pronto para copiar e conferir em qualquer casa de aposta.</p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="stake" className="mb-1 block text-[10px] uppercase text-muted-foreground">Aposta</Label>
                      <Input
                        id="stake"
                        type="number"
                        min="1"
                        step="1"
                        value={valorAposta}
                        onChange={(e) => setValorAposta(e.target.value)}
                        className="h-10 bg-input/40 text-sm"
                      />
                    </div>
                    <div className="rounded-md border border-border bg-muted/30 p-2 text-right">
                      <p className="text-[10px] uppercase text-muted-foreground">Odd total</p>
                      <p className="text-sm font-bold">{ticket.oddTotal.toFixed(2)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Prêmio pot.</p>
                      <p className="text-xl font-bold text-primary">{premioPotencial.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="mt-4 w-full font-semibold"
                    onClick={() => {
                      const txt = ticket.picks
                        .map((p, i) => `${i + 1}. ${p.jogo} — ${traduzTermo(p.mercado)}: ${traduzTermo(p.selecao)} @ ${p.oddEstimada.toFixed(2)}`)
                        .join("\n");
                      navigator.clipboard.writeText(`${txt}\n\nOdd total: ${ticket.oddTotal.toFixed(2)}\nValor: R$ ${valorAposta}\nPrêmio potencial: ${premioPotencial.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
                      toast.success("Bilhete pronto copiado!");
                    }}
                  >
                    Copiar bilhete pronto
                  </Button>
                </div>
              </aside>
            </div>

            {ticket.analiseJogos && ticket.analiseJogos.length > 0 && (
              <div className="border-t border-border/60 bg-card p-5">
                <h3 className="mb-1 text-sm font-bold uppercase tracking-wider text-primary">
                  Análise dos jogos com várias seleções
                </h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Estimativas de escanteios, gols, chutes ao gol e cartões (times e árbitro) para jogos com mais de uma opção no bilhete.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {ticket.analiseJogos.map((a, i) => (
                    <div key={`${a.jogo}-${i}`} className="rounded-lg border border-border/70 bg-muted/20 p-4">
                      <h4 className="mb-3 text-sm font-semibold">{traduzPaises(a.jogo)}</h4>
                      <ul className="space-y-2 text-xs">
                        <li>
                          <span className="font-semibold text-foreground/90">⚑ Escanteios: </span>
                          <span className="text-muted-foreground">{a.escanteios}</span>
                        </li>
                        <li>
                          <span className="font-semibold text-foreground/90">⚽ Gols: </span>
                          <span className="text-muted-foreground">{a.gols}</span>
                        </li>
                        <li>
                          <span className="font-semibold text-foreground/90">🎯 Chutes ao gol: </span>
                          <span className="text-muted-foreground">{a.chutesAoGol}</span>
                        </li>
                        <li>
                          <span className="font-semibold text-foreground/90">🟨 Cartões (times): </span>
                          <span className="text-muted-foreground">{a.cartoesTimes}</span>
                        </li>
                        <li>
                          <span className="font-semibold text-foreground/90">🧑‍⚖️ Cartões (árbitro): </span>
                          <span className="text-muted-foreground">{a.cartoesArbitro}</span>
                        </li>
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}



            {ticket.observacoes && (
              <div className="border-t border-border/60 bg-muted/30 p-5 text-sm text-muted-foreground">
                <strong className="text-foreground">Observações: </strong>
                {ticket.observacoes}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 bg-muted/20 p-5">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const txt = ticket.picks
                    .map((p, i) => `${i + 1}. ${p.jogo} — ${traduzTermo(p.mercado)}: ${traduzTermo(p.selecao)} @ ${p.oddEstimada.toFixed(2)}`)
                    .join("\n");
                  navigator.clipboard.writeText(`${txt}\n\nOdd total: ${ticket.oddTotal.toFixed(2)}`);
                  toast.success("Bilhete copiado!");
                }}
              >
                Copiar bilhete
              </Button>
              <p className="text-xs text-muted-foreground">
                Este bilhete vale para qualquer casa de aposta. Use "Abrir jogo" em cada entrada para localizar o jogo na sua casa preferida, adicione à sacola e finalize como múltipla com o valor da odd escolhida.
              </p>
            </div>
          </Card>
        )}
        </div>

        {temAcesso && salvos.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-bold">Meus bilhetes salvos</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {salvos.map((b) => (
                <Card key={b.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      Odd total: <span className="text-primary">{b.oddTotal.toFixed(2)}</span>
                    </p>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary">
                        {new Date(b.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeletarBilhete(b.id)}
                        disabled={deletandoId === b.id}
                        aria-label="Deletar bilhete"
                      >
                        {deletandoId === b.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{b.picks.length} {b.picks.length === 1 ? "seleção" : "seleções"}</span>
                    <span>· Confiança {Math.round(b.confianca)}%</span>
                    <span>· Risco {b.risco}</span>
                  </div>
                  {b.picks.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs">
                      {b.picks.map((p: any, i: number) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{traduzTermo(p.mercado)}: {traduzTermo(p.selecao)}</span>
                          <span className="shrink-0 font-medium">@ {Number(p.odd).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}








        <p className="mt-8 text-center text-xs text-muted-foreground">
          Aposte com responsabilidade. Conteúdo apenas informativo.
        </p>
      </div>

      {janela && (
        <FloatingBrowser
          url={janela.url}
          title={janela.title}
          onClose={() => setJanela(null)}
        />
      )}

      <Dialog open={!!estatJogo} onOpenChange={(o) => !o && setEstatJogo(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Análise detalhada</DialogTitle>
          </DialogHeader>

          {loadingEstat ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando estatísticas...
            </div>
          ) : !estatPayload ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <p>Estatísticas ainda não coletadas para este jogo.</p>
              <p className="mt-2 text-xs">
                As estatísticas (forma, gols, escanteios, cartões e árbitro) vêm da API-Football.
                Peça ao administrador para configurar e ativar a chave <strong>API_FOOTBALL_KEY</strong> no
                painel de APIs e rodar a operação — sem ela nenhuma estatística é coletada.
              </p>
            </div>
          ) : (() => {
            const pnum = (v: string | null | undefined) => {
              const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
              return Number.isFinite(n) ? n : 0;
            };
            const pc = pnum(estatPayload.percent.casa);
            const pe = pnum(estatPayload.percent.empate);
            const pf = pnum(estatPayload.percent.fora);
            const soma = pc + pe + pf || 1;
            const confAlta = pc >= 55 || pf >= 55;
            const forma = (s: string | null) =>
              (s ?? "").toUpperCase().replace(/[^WDLVE]/g, "").split("").slice(-5);
            const formaCor = (ch: string) =>
              ch === "W" || ch === "V"
                ? "bg-primary/20 text-primary"
                : ch === "L" || ch === "D"
                  ? "bg-destructive/20 text-destructive"
                  : "bg-muted text-muted-foreground";
            const formaLetra = (ch: string) =>
              ch === "W" ? "V" : ch === "L" ? "D" : ch;
            const temArbitro = !!(estatJogo?.arbitro && String(estatJogo.arbitro).trim());
            return (
              <div className="space-y-4">
                {/* Cabeçalho do confronto */}
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Trophy className="h-3.5 w-3.5" /> {estatJogo?.liga ?? "—"}
                    </p>
                    {confAlta && (
                      <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                        <Sparkles className="h-3 w-3" /> Confiança Alta
                      </Badge>
                    )}
                  </div>
                  <h3 className="mt-2 text-xl font-bold">
                    {estatJogo ? traduzPaises(estatJogo.time_casa) : ""}{" "}
                    <span className="text-muted-foreground">x</span>{" "}
                    {estatJogo ? traduzPaises(estatJogo.time_fora) : ""}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Início {estatJogo ? new Date(estatJogo.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </p>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full">
                    <div className="bg-primary" style={{ width: `${(pc / soma) * 100}%` }} />
                    <div className="bg-muted-foreground/50" style={{ width: `${(pe / soma) * 100}%` }} />
                    <div className="bg-sky-500" style={{ width: `${(pf / soma) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs font-medium">
                    <span className="text-primary">1 · {pc}%</span>
                    <span className="text-muted-foreground">X · {pe}%</span>
                    <span className="text-sky-500">2 · {pf}%</span>
                  </div>
                </div>

                <Tabs defaultValue="gols">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="gols" className="gap-1.5 text-xs"><Target className="h-3.5 w-3.5" /> Gols</TabsTrigger>
                    <TabsTrigger value="escanteios" className="gap-1.5 text-xs"><Flag className="h-3.5 w-3.5" /> Escanteios</TabsTrigger>
                    <TabsTrigger value="cartoes" className="gap-1.5 text-xs"><CreditCard className="h-3.5 w-3.5" /> Cartões</TabsTrigger>
                    <TabsTrigger value="forma" className="gap-1.5 text-xs"><LineChart className="h-3.5 w-3.5" /> Forma</TabsTrigger>
                  </TabsList>

                  {/* GOLS */}
                  <TabsContent value="gols" className="space-y-3 pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      {([
                        { nome: estatJogo ? traduzPaises(estatJogo.time_casa) : "", feitos: estatPayload.golsFeitosCasa, sofridos: estatPayload.golsSofridosCasa },
                        { nome: estatJogo ? traduzPaises(estatJogo.time_fora) : "", feitos: estatPayload.golsFeitosFora, sofridos: estatPayload.golsSofridosFora },
                      ]).map((t, i) => (
                        <div key={i} className="space-y-2">
                          <p className="truncate text-xs font-bold">{t.nome}</p>
                          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-primary" /> Gols feitos / jogo</span>
                            <span className="font-bold">{t.feitos ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                            <span className="flex items-center gap-1.5 text-muted-foreground"><TrendingDown className="h-3.5 w-3.5 text-destructive" /> Gols sofridos / jogo</span>
                            <span className="font-bold">{t.sofridos ?? "—"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">Gols previstos</span>
                        <span className="font-bold">{estatPayload.golsPrev.casa ?? "—"} / {estatPayload.golsPrev.fora ?? "—"}</span>
                      </div>
                      {estatPayload.underOver && (
                        <p className="mt-1 text-xs text-muted-foreground">Tendência · {estatPayload.underOver}</p>
                      )}
                    </div>
                  </TabsContent>

                  {/* ESCANTEIOS */}
                  <TabsContent value="escanteios" className="space-y-2 pt-3">
                    {estatEscanteios ? (
                      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-center">
                        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Flag className="h-3.5 w-3.5 text-primary" /> Tendência de escanteios</p>
                        <p className="mt-1 text-lg font-bold">{estatEscanteios}</p>
                      </div>
                    ) : (
                      <p className="py-6 text-center text-sm text-muted-foreground">Sem dados de escanteios para este jogo.</p>
                    )}
                  </TabsContent>

                  {/* CARTÕES */}
                  <TabsContent value="cartoes" className="space-y-2 pt-3">
                    <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><CreditCard className="h-3.5 w-3.5 text-amber-500" /> {estatJogo ? traduzPaises(estatJogo.time_casa) : ""} · média cartões</span>
                      <span className="font-bold">{estatPayload.cartoesCasa ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground"><CreditCard className="h-3.5 w-3.5 text-amber-500" /> {estatJogo ? traduzPaises(estatJogo.time_fora) : ""} · média cartões</span>
                      <span className="font-bold">{estatPayload.cartoesFora ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                      <span className="text-muted-foreground">Média no confronto</span>
                      <span className="font-bold">{estatPayload.cartoesConfronto ?? "—"}</span>
                    </div>
                    {temArbitro ? (
                      <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 text-sm">
                        <span className="text-muted-foreground">Árbitro · {estatJogo?.arbitro}</span>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border/60 p-3">
                        <p className="text-sm text-muted-foreground">Árbitro: Não escalado</p>
                        <Badge variant="outline" className="mt-1.5 text-[10px] font-normal text-muted-foreground">
                          Estatísticas de cartões baseadas apenas no histórico dos times
                        </Badge>
                      </div>
                    )}
                  </TabsContent>

                  {/* FORMA */}
                  <TabsContent value="forma" className="space-y-4 pt-3">
                    {([
                      { nome: estatJogo ? traduzPaises(estatJogo.time_casa) : "", f: estatPayload.formaCasa },
                      { nome: estatJogo ? traduzPaises(estatJogo.time_fora) : "", f: estatPayload.formaFora },
                    ]).map((t, i) => (
                      <div key={i}>
                        <p className="mb-2 text-sm font-bold">{t.nome} · últimos 5</p>
                        <div className="flex gap-2">
                          {forma(t.f).length ? (
                            forma(t.f).map((ch, j) => (
                              <span key={j} className={`flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold ${formaCor(ch)}`}>
                                {formaLetra(ch)}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">Sem dados de forma.</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">V = vitória · E = empate · D = derrota</p>
                  </TabsContent>
                </Tabs>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

    </main>
  );
}
