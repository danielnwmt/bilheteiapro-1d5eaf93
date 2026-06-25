import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { gerarBilhete } from "@/lib/ticket.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Target, TrendingUp, Trophy, Building2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BilheteIA — Análise de futebol e múltiplas com IA" },
      { name: "description", content: "Cole os jogos, defina a odd alvo e a IA monta a múltipla ideal com análise jogo a jogo." },
      { property: "og:title", content: "BilheteIA — Múltiplas analisadas por IA" },
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

const CASAS = [
  {
    id: "bet365",
    nome: "Bet365",
    url: "https://www.bet365.bet.br/",
    search: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(`bet365 ${q}`)}`,
  },
  {
    id: "betano",
    nome: "Betano",
    url: "https://www.betano.bet.br/sport/futebol/",
    search: (q: string) => `https://www.betano.bet.br/search/?query=${encodeURIComponent(q)}`,
  },
  {
    id: "superbet",
    nome: "Superbet",
    url: "https://superbet.bet.br/apostas/futebol",
    search: (q: string) => `https://superbet.bet.br/search?query=${encodeURIComponent(q)}`,
  },
  {
    id: "kto",
    nome: "KTO",
    url: "https://www.kto.bet.br/sports/pre-game/Soccer-1/",
    search: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(`kto ${q}`)}`,
  },
  {
    id: "sportingbet",
    nome: "Sportingbet",
    url: "https://sports.sportingbet.bet.br/pt-br/sports/futebol-4",
    search: (q: string) => `https://sports.sportingbet.bet.br/pt-br/search?query=${encodeURIComponent(q)}`,
  },
  {
    id: "betfair",
    nome: "Betfair",
    url: "https://www.betfair.bet.br/sport/futebol",
    search: (q: string) => `https://www.betfair.bet.br/sport/search?query=${encodeURIComponent(q)}`,
  },
] as const;

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

function Index() {
  const run = useServerFn(gerarBilhete);
  const [oddAlvo, setOddAlvo] = useState("5");
  const [valorAposta, setValorAposta] = useState("20");
  const [periodo, setPeriodo] = useState<"hoje" | "amanha" | "semana" | "aovivo">("hoje");
  const [casa, setCasa] = useState<(typeof CASAS)[number]["id"]>("bet365");
  const [campSel, setCampSel] = useState<string[]>([]);
  const [mercSel, setMercSel] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const odd = parseFloat(oddAlvo);
    if (!odd) {
      toast.error("Defina a odd alvo");
      return;
    }
    setLoading(true);
    setTicket(null);
    try {
      const r = await run({ data: { oddAlvo: odd, periodo, campeonatos: campSel, mercados: mercSel, casa: casaAtual.nome } });
      setTicket(r);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Erro ao gerar bilhete.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const riscoColor = {
    baixo: "bg-primary/20 text-primary border-primary/30",
    medio: "bg-accent/20 text-accent border-accent/30",
    alto: "bg-destructive/20 text-destructive border-destructive/30",
  } as const;

  const casaAtual = CASAS.find((c) => c.id === casa)!;
  const premioPotencial = ticket ? (parseFloat(valorAposta) || 0) * ticket.oddTotal : 0;
  const riscoPct =
    ticket && ticket.picks.length
      ? Math.round(
          100 -
            ticket.picks.reduce((acc, p) => acc + (p.confianca || 0), 0) / ticket.picks.length,
        )
      : 0;

  function toggleCamp(c: string) {
    setCampSel((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function toggleMerc(m: string) {
    setMercSel((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10 md:py-16">
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Jogos ao vivo + IA
          </div>
          <h1 className="mt-4 text-4xl font-bold md:text-6xl">
            Bilhete<span className="text-primary">IA</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Escolha a odd alvo e o período. Lemos os jogos e odds do seu banco (API-Sports) e a IA monta sua múltipla.
          </p>
        </header>

        <Card className="border-border/60 bg-card p-6 md:p-8">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="odd" className="mb-2 flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-primary" /> Odd alvo da múltipla
                </Label>
                <Input
                  id="odd"
                  type="number"
                  step="0.1"
                  min="1.1"
                  value={oddAlvo}
                  onChange={(e) => setOddAlvo(e.target.value)}
                  className="bg-input/40"
                />
              </div>
              <div>
                <Label className="mb-2 flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-primary" /> Período
                </Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["aovivo", "hoje", "amanha", "semana"] as const).map((p) => (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setPeriodo(p)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                        periodo === p
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {p === "amanha" ? "amanhã" : p === "aovivo" ? "🔴 ao vivo" : p}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-primary">Todas as entradas exigem confiança ≥ 90%.</p>
              </div>
            </div>

            <div>
              <Label className="mb-2 flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-primary" /> Casa de aposta
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                {CASAS.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCasa(c.id)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      casa === c.id
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 flex items-center gap-2 text-sm">
                <Trophy className="h-4 w-4 text-primary" /> Campeonatos {campSel.length > 0 && <span className="text-xs text-muted-foreground">({campSel.length} selecionados)</span>}
              </Label>
              <div className="flex flex-wrap gap-2">
                {CAMPEONATOS.map((c) => {
                  const active = campSel.includes(c);
                  return (
                    <button
                      type="button"
                      key={c}
                      onClick={() => toggleCamp(c)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Deixe vazio para considerar qualquer campeonato.</p>
            </div>

            <Button
              type="submit"
              disabled={loading}
              size="lg"
              className="w-full font-semibold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando jogos e analisando...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Buscar jogos e gerar bilhete
                </>
              )}
            </Button>
          </form>
        </Card>

        {ticket && (
          <Card className="mt-8 overflow-hidden border-primary/30 bg-card">
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
                <Badge className={`${riscoColor[ticket.risco]} border px-3 py-1 text-xs uppercase`}>
                  Risco {ticket.risco} · {riscoPct}%
                </Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{ticket.resumo}</p>
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
                          <span className="font-medium text-foreground/80">{p.mercado}</span>
                        </div>
                        <h3 className="mt-1 text-base font-semibold">{p.jogo}</h3>
                        <p className="mt-1 text-primary font-medium">{p.selecao}</p>
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
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={p.deepLink ?? casaAtual.search(p.jogo)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir jogo na {casaAtual.nome} <ExternalLink className="ml-2 h-3.5 w-3.5" />
                        </a>
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
                    {ticket.picks.map((p, i) => (
                      <div key={`${p.jogo}-${i}`} className="rounded-md border border-border/70 bg-muted/30 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold">{p.jogo}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{p.data}</p>
                          </div>
                          <span className="text-xs font-bold text-primary">{p.oddEstimada.toFixed(2)}</span>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{p.selecao}</p>
                            <p className="text-[10px] text-muted-foreground">{p.mercado}</p>
                          </div>
                          <span className="text-[10px] font-semibold text-primary">{p.confianca}%</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold uppercase text-primary">Supermúltipla</p>
                      <span className="text-lg">🙂</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">Bilhete pronto para copiar e conferir na {casaAtual.nome}.</p>
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
                      <p className="text-[10px] uppercase text-muted-foreground">Odds</p>
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
                        .map((p, i) => `${i + 1}. ${p.jogo} — ${p.mercado}: ${p.selecao} @ ${p.oddEstimada.toFixed(2)}`)
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
                      <h4 className="mb-3 text-sm font-semibold">{a.jogo}</h4>
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
                    .map((p, i) => `${i + 1}. ${p.jogo} — ${p.mercado}: ${p.selecao} @ ${p.oddEstimada.toFixed(2)}`)
                    .join("\n");
                  navigator.clipboard.writeText(`${txt}\n\nOdd total: ${ticket.oddTotal.toFixed(2)}`);
                  toast.success("Bilhete copiado!");
                }}
              >
                Copiar bilhete
              </Button>
              <Button
                type="button"
                asChild
                className="font-semibold"
              >
                <a href={casaAtual.url} target="_blank" rel="noopener noreferrer">
                  Abrir {casaAtual.nome} <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                As casas de aposta não permitem montar múltiplas via link. Use "Abrir jogo na {casaAtual.nome}" em cada entrada para buscar o jogo, adicione à sua sacola e finalize como múltipla na {casaAtual.nome}.
              </p>
            </div>
          </Card>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Aposte com responsabilidade. Conteúdo apenas informativo.
        </p>
      </div>
    </main>
  );
}
