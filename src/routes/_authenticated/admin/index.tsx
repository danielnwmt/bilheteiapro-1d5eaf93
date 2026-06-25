import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getClientStats } from "@/lib/access.functions";
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
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { deploySystem } from "@/lib/deploy.functions";
import { toast } from "sonner";
import { usePlanos } from "@/hooks/usePlanos";
import { AccentPicker } from "@/components/AccentPicker";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
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

function AdminDashboard() {
  const router = useRouter();
  const { byPlano } = usePlanos();
  const fetchStats = useServerFn(getClientStats);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  const atualizar = useServerFn(deploySystem);
  const mutDeploy = useMutation({
    mutationFn: () => atualizar(),
    onSuccess: () => toast.success("Atualização iniciada. Aguarde alguns instantes."),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao atualizar o sistema"),
  });



  const { data: stats, isLoading } = useQuery({
    queryKey: ["client-stats"],
    queryFn: () => fetchStats(),
  });

  const planoLabel = (p: string) =>
    p === "sem" ? "Sem plano" : byPlano?.[p as "start" | "pro" | "elite"]?.nome ?? p;

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
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/usuarios" })}>
              <Users className="mr-2 h-4 w-4" /> Clientes
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/configuracoes" })}>
              <Settings className="mr-2 h-4 w-4" /> Planos
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/apis" })}>
              <KeyRound className="mr-2 h-4 w-4" /> APIs
            </Button>
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

            <div className="mb-6">
              <AccentPicker />
            </div>



            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-border/60 bg-card p-5">
                <h2 className="mb-4 text-sm font-semibold text-muted-foreground">
                  Novos clientes (últimos 6 meses)
                </h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats?.cadastrosPorMes ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--foreground)",
                        }}
                      />
                      <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
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
                          outerRadius={80}
                          label
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend />
                        <Tooltip
                          contentStyle={{
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            color: "var(--foreground)",
                          }}
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
                    <AreaChart data={stats?.faturamentoPorMes ?? []}>
                      <defs>
                        <linearGradient id="fatGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="mes" stroke="var(--muted-foreground)" fontSize={12} />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={12}
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
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        fill="url(#fatGrad)"
                      />
                    </AreaChart>
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
  value: number;
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
