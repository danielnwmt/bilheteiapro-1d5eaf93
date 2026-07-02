import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getClientStats, iniciarOperacao } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2,
  Users,
  UserCheck,
  UserX,
  Crown,
  KeyRound,
  Settings,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Cog,
  ShoppingCart,
  DollarSign,
  Wallet,
  Play,
  Wifi,




} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { deploySystem } from "@/lib/deploy.functions";
import { toast } from "sonner";
import { usePlanos } from "@/hooks/usePlanos";
import { AccentPicker } from "@/components/AccentPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Painel — Admin BilheteIA" }] }),
  component: AdminDashboard,
});

const PIE_COLORS = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-5)",
];

const EMPTY_STATS = {
  totalClientes: 0,
  ativos: 0,
  online: 0,
  cortesias: 0,
  inativos: 0,
  porPlano: { start: 0, pro: 0, elite: 0, cortesia: 0, sem: 0 },
  cadastrosPorMes: [],
  faturamentoPorMes: [],
  vendasDia: 0,
  faturamentoDia: 0,
  recebidos: 0,
};

function AdminDashboard() {
  const router = useRouter();
  const { byPlano } = usePlanos();
  const fetchStats = useServerFn(getClientStats);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  // Limpa mensagens de erro HTML (ex.: 504 Gateway Time-out do nginx)
  const limparErroUI = (raw: unknown, fallback: string): string => {
    const msg = typeof raw === "string" ? raw : (raw as any)?.message ?? "";
    if (!msg) return fallback;
    if (/504|gateway time-?out/i.test(msg))
      return "A operação demorou demais e expirou (504). Os dados são processados em segundo plano — aguarde alguns minutos e verifique novamente.";
    if (/<\/?[a-z][\s\S]*>/i.test(msg)) return fallback;
    return msg;
  };

  const [deployProgress, setDeployProgress] = useState(0);
  const atualizar = useServerFn(deploySystem);
  const mutDeploy = useMutation({
    mutationFn: () => atualizar(),
    onSuccess: () =>
      toast.success("Atualização iniciada! O servidor vai reiniciar em 1-2 minutos.", { duration: 6000 }),
    onError: (e: any) =>
      toast.error(limparErroUI(e?.message, "Erro ao atualizar o sistema"), { duration: 12000 }),
  });

  // Barra de progresso da atualização (~100s até reiniciar)
  useEffect(() => {
    if (!mutDeploy.isSuccess) return;
    setDeployProgress(0);
    const inicio = Date.now();
    const total = 100_000; // 100s estimados
    const id = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - inicio) / total) * 100));
      setDeployProgress(pct);
      if (pct >= 100) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [mutDeploy.isSuccess]);

  const iniciar = useServerFn(iniciarOperacao);
  const mutOperacao = useMutation({
    mutationFn: () => iniciar(),
    onSuccess: (r: any) => {
      const falhas = (r?.etapas ?? []).filter((e: any) => !e.ok);
      if (falhas.length === 0) {
        toast.success("Operação concluída! Jogos, odds e análises atualizados.", { duration: 6000 });
      } else {
        toast.warning(
          "Operação concluída com avisos: " + falhas.map((e: any) => `${e.etapa}: ${e.info}`).join(" | "),
          { duration: 12000 },
        );
      }
    },
    onError: (e: any) =>
      toast.error(limparErroUI(e?.message, "Erro ao iniciar a operação"), { duration: 12000 }),
  });

  // Cronômetro do tempo de execução da operação
  const [tempoOperacao, setTempoOperacao] = useState(0);
  const inicioRef = useRef<number | null>(null);
  useEffect(() => {
    if (mutOperacao.isPending) {
      inicioRef.current = Date.now();
      setTempoOperacao(0);
      const id = setInterval(() => {
        if (inicioRef.current) {
          setTempoOperacao(Math.floor((Date.now() - inicioRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(id);
    }
  }, [mutOperacao.isPending]);

  const formatarTempo = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;







  const { data: stats, isLoading } = useQuery({
    queryKey: ["client-stats"],
    queryFn: () => fetchStats(),
    placeholderData: EMPTY_STATS,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const planoLabel = (p: string) =>
    p === "sem"
      ? "Sem plano"
      : p === "cortesia"
        ? "Cortesia"
        : byPlano?.[p as "start" | "pro" | "elite"]?.nome ?? p;

  const pieData = stats
    ? Object.entries(stats.porPlano)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => ({ name: planoLabel(k), value: v }))
    : [];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Painel do administrador</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <AccentPicker compact />
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/usuarios" })}>
              <Users className="mr-2 h-4 w-4" /> Clientes
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/configuracoes" })}>
              <Settings className="mr-2 h-4 w-4" /> Planos
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/ssl" })}>
              <ShieldCheck className="mr-2 h-4 w-4" /> SSL
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Cog className="mr-2 h-4 w-4" /> Configurações
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={mutOperacao.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    mutOperacao.mutate();
                  }}
                >
                  {mutOperacao.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {mutOperacao.isPending
                    ? `Rodando… ${formatarTempo(tempoOperacao)}`
                    : "Iniciar operação"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.navigate({ to: "/admin/apis" })}>
                  <KeyRound className="mr-2 h-4 w-4" /> APIs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.navigate({ to: "/admin/backup" })}>
                  <Cog className="mr-2 h-4 w-4" /> Backup
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={mutDeploy.isPending}
                  onClick={() => mutDeploy.mutate()}
                >
                  {mutDeploy.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Atualizar sistema
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => router.navigate({ to: "/" })}>
              Modo cliente
            </Button>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Users} label="Total de clientes" value={stats?.totalClientes ?? 0} />
              <StatCard icon={UserCheck} label="Ativos" value={stats?.ativos ?? 0} accent />
              <StatCard icon={UserX} label="Inativos" value={stats?.inativos ?? 0} />
              <StatCard
                icon={Crown}
                label="Planos pagos"
                value={
                  (stats?.porPlano.start ?? 0) +
                  (stats?.porPlano.pro ?? 0) +
                  (stats?.porPlano.elite ?? 0)
                }
              />
            </div>

            <div className="mb-8">
              <Card className="border-primary/40 bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                    </span>
                    Usuários online agora
                  </div>
                  <Wifi className="h-5 w-5 text-primary" />
                </div>
                <p className="mt-2 text-3xl font-bold">{stats?.online ?? 0}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Logados e ativos nos últimos 5 minutos.
                </p>
              </Card>
            </div>


            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                icon={ShoppingCart}
                label="Vendas do dia"
                value={stats?.vendasDia ?? 0}
                accent
              />
              <StatCard
                icon={DollarSign}
                label="Faturamento do dia"
                value={`R$ ${(stats?.faturamentoDia ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              />
              <StatCard
                icon={Wallet}
                label="Recebidos"
                value={`R$ ${(stats?.recebidos ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
              />
            </div>






            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-border/60 bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
                  Novos clientes (últimos 6 meses)
                </h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats?.cadastrosPorMes ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                      <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={28} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--foreground)",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="Novos clientes"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card className="border-border/60 bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
                  Distribuição por plano
                </h2>
                <div className="h-64">
                  {pieData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Sem dados ainda.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={2}
                          stroke="var(--card)"
                          strokeWidth={2}
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            color: "var(--foreground)",
                          }}
                        />
                        <Legend
                          iconType="square"
                          iconSize={10}
                          wrapperStyle={{ fontSize: 12 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
            </div>

            <div className="mt-6">
              <Card className="border-border/60 bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
                  Faturamento por mês (últimos 6 meses)
                </h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats?.faturamentoPorMes ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                      <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        width={56}
                        tickFormatter={(v) => `R$ ${v}`}
                      />
                      <Tooltip
                        formatter={(v: number) =>
                          `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        }
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--foreground)",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        name="Faturamento"
                        stroke="var(--primary)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "var(--card)", stroke: "var(--primary)", strokeWidth: 2 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

          </>
        )}
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={accent ? "h-5 w-5 text-primary" : "h-5 w-5 text-muted-foreground"} />
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </Card>
  );
}
