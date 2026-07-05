import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboard, type DashboardResumo } from "@/lib/dashboard.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Percent,
  Wallet,
  Target,
  Trophy,
  Flame,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Ticket as TicketIcon,
  CalendarDays,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — BilheteIA PRO" }] }),
  component: DashboardPage,
});

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;
const fmtData = (d: string) => {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
};

/** Cartão de métrica compacto e reutilizável. */
function Metric({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "green" | "red";
}) {
  const toneClass =
    tone === "green" ? "text-emerald-500" : tone === "red" ? "text-rose-500" : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function DashboardPage() {
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <Card className="mt-6 p-6 text-center text-muted-foreground">
          {(error as Error)?.message ?? "Não foi possível carregar o dashboard. Tente novamente."}
        </Card>
      </div>
    );
  }

  const d = data as DashboardResumo;
  const semDados = d.totalApostas === 0;
  const lucroTone = d.lucroLiquido >= 0 ? "green" : "red";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Cabeçalho */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black sm:text-3xl">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral da sua performance
            {d.diasComoAssinante > 0 && ` · ${d.diasComoAssinante} dias na plataforma`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/banca" })}>
            <Wallet className="mr-2 h-4 w-4" /> Banca
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Início
          </Button>
        </div>
      </header>

      {semDados && (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          Ainda não há apostas registradas. Registre suas entradas em{" "}
          <button
            className="font-semibold text-primary underline"
            onClick={() => router.navigate({ to: "/banca" })}
          >
            Gestão de Banca
          </button>{" "}
          para ver seus números aqui.
        </Card>
      )}

      {/* Métricas principais */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          icon={<Wallet className="h-4 w-4" />}
          label="Lucro líquido"
          value={brl(d.lucroLiquido)}
          tone={lucroTone}
          hint={`ROI ${pct(d.roi)}`}
        />
        <Metric
          icon={<Percent className="h-4 w-4" />}
          label="Taxa de acerto"
          value={pct(d.taxaAcerto)}
          hint={`${d.green}G / ${d.red}R`}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4" />}
          label="Valor apostado"
          value={brl(d.valorApostado)}
        />
        <Metric
          icon={<Trophy className="h-4 w-4" />}
          label="Valor retornado"
          value={brl(d.valorRetornado)}
        />
        <Metric
          icon={<TicketIcon className="h-4 w-4" />}
          label="Bilhetes gerados"
          value={String(d.bilhetesGerados)}
        />
        <Metric
          icon={<Target className="h-4 w-4" />}
          label="Odd média"
          value={d.oddMedia.toFixed(2)}
          hint={`Stake média ${brl(d.stakeMedia)}`}
        />
        <Metric
          icon={<Flame className="h-4 w-4" />}
          label="Sequência atual"
          value={
            d.seqAtual === 0
              ? "—"
              : d.seqAtual > 0
                ? `${d.seqAtual} greens`
                : `${Math.abs(d.seqAtual)} reds`
          }
          tone={d.seqAtual > 0 ? "green" : d.seqAtual < 0 ? "red" : "default"}
          hint={`Máx ${d.seqGreenMax}G / ${d.seqRedMax}R`}
        />
        <Metric
          icon={<Activity className="h-4 w-4" />}
          label="Yield"
          value={pct(d.yield)}
          hint={`${d.totalApostas} apostas`}
        />
      </section>

      {/* Contadores G/R/Void */}
      <section className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-emerald-500">
            <CheckCircle2 className="h-4 w-4" />{" "}
            <span className="text-xs font-semibold uppercase">Green</span>
          </div>
          <p className="mt-1 text-xl font-black">{d.green}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-rose-500">
            <XCircle className="h-4 w-4" />{" "}
            <span className="text-xs font-semibold uppercase">Red</span>
          </div>
          <p className="mt-1 text-xl font-black">{d.red}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MinusCircle className="h-4 w-4" />{" "}
            <span className="text-xs font-semibold uppercase">Void</span>
          </div>
          <p className="mt-1 text-xl font-black">{d.void}</p>
        </Card>
      </section>

      {/* Evolução da banca */}
      {d.evolucao.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Evolução da banca (lucro acumulado)
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.evolucao} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="lucroGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="data"
                  tickFormatter={fmtData}
                  fontSize={11}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={48} />
                <Tooltip
                  formatter={(v: number) => brl(v)}
                  labelFormatter={fmtData}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="acumulado"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#lucroGrad)"
                  name="Acumulado"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Lucro por dia da semana + destaques */}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.porDiaSemana.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Lucro por dia da semana
            </h2>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.porDiaSemana} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    fontSize={10}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(l: string) => l.slice(0, 3)}
                  />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" width={48} />
                  <Tooltip
                    formatter={(v: number) => brl(v)}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="lucro" radius={[4, 4, 0, 0]}>
                    {d.porDiaSemana.map((p, i) => (
                      <Cell key={i} fill={p.lucro >= 0 ? "hsl(142 71% 45%)" : "hsl(347 77% 50%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Estatísticas
          </h2>
          <dl className="space-y-2 text-sm">
            <Linha
              label="Maior odd vencedora"
              value={d.maiorOddVencedora ? d.maiorOddVencedora.toFixed(2) : "—"}
            />
            <Linha
              label="Maior odd perdida"
              value={d.maiorOddPerdida ? d.maiorOddPerdida.toFixed(2) : "—"}
            />
            <Linha label="Stake média" value={brl(d.stakeMedia)} />
            <Linha
              label="Melhor dia da semana"
              value={
                d.melhorDiaSemana
                  ? `${d.melhorDiaSemana.label} (${brl(d.melhorDiaSemana.lucro)})`
                  : "—"
              }
            />
            <Linha
              label="Esporte mais lucrativo"
              value={
                d.melhorEsporte ? `${d.melhorEsporte.label} (${brl(d.melhorEsporte.lucro)})` : "—"
              }
            />
            {d.piorEsporte && (
              <Linha
                label="Esporte menos lucrativo"
                value={`${d.piorEsporte.label} (${brl(d.piorEsporte.lucro)})`}
              />
            )}
            <Linha label="Sequência máx. de greens" value={String(d.seqGreenMax)} />
            <Linha label="Sequência máx. de reds" value={String(d.seqRedMax)} />
          </dl>
        </Card>
      </div>

      {/* Atividades recentes */}
      {d.atividades.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" /> Últimas atividades
          </h2>
          <ul className="divide-y divide-border">
            {d.atividades.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.descricao || "Aposta"}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtData(a.data)} · odd {a.odd.toFixed(2)} · {brl(a.valor)}
                  </p>
                </div>
                <ResultadoBadge resultado={a.resultado} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Linha({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function ResultadoBadge({ resultado }: { resultado: string }) {
  if (resultado === "green")
    return (
      <Badge className="shrink-0 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
        Green
      </Badge>
    );
  if (resultado === "red")
    return (
      <Badge className="shrink-0 bg-rose-500/15 text-rose-500 hover:bg-rose-500/15">Red</Badge>
    );
  if (resultado === "anulada")
    return (
      <Badge variant="secondary" className="shrink-0">
        Void
      </Badge>
    );
  return (
    <Badge variant="outline" className="shrink-0">
      Pendente
    </Badge>
  );
}
