import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listBancaEntradas,
  addBancaEntrada,
  updateBancaEntrada,
  deleteBancaEntrada,
  type BancaEntrada,
  type Resultado,
} from "@/lib/banca.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Wallet,
  TrendingUp,
  Target,
  Percent,
  Lock,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { useAccess } from "@/hooks/useAccess";
import { usePlanos } from "@/hooks/usePlanos";
import { recursoLiberado } from "@/lib/planos";

export const Route = createFileRoute("/_authenticated/banca")({
  head: () => ({ meta: [{ title: "Gestão de Banca — BilheteIA PRO" }] }),
  component: BancaPage;
});

const RESULTADOS: { v: Resultado; label: string }[] = [
  { v: "pendente", label: "Pendente" },
  { v: "green", label: "Green (ganhou)" },
  { v: "red", label: "Red (perdeu)" },
  { v: "anulada", label: "Anulada" },
];

function lucroDe(e: { valor: number; odd: number; resultado: Resultado }) {
  if (e.resultado === "green") return e.valor * (e.odd - 1);
  if (e.resultado === "red") return -e.valor;
  return 0;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function BancaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: access } = useAccess();
  const { byPlano } = usePlanos();
  const planoCfg = access?.plano ? byPlano?.[access.plano] : null;
  const liberado = recursoLiberado(planoCfg, "planilhaBanca");

  const fetchEntradas = useServerFn(listBancaEntradas);
  const addFn = useServerFn(addBancaEntrada);
  const updFn = useServerFn(updateBancaEntrada);
  const delFn = useServerFn(deleteBancaEntrada);

  const hoje = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    data: hoje,
    descricao: "",
    valor: "",
    odd: "",
    resultado: "pendente" as Resultado,
  });

  const { data: entradas, isLoading } = useQuery({
    queryKey: ["banca"],
    queryFn: () => fetchEntradas(),
    enabled: liberado,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["banca"] });

  const mutAdd = useMutation({
    mutationFn: (v: Parameters<typeof addBancaEntrada>[0]["data"]) => addFn({ data: v }),
    onSuccess: () => {
      toast.success("Entrada adicionada");
      setForm({ data: hoje, descricao: "", valor: "", odd: "", resultado: "pendente" });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao adicionar"),
  });

  const mutUpd = useMutation({
    mutationFn: (v: Parameters<typeof updateBancaEntrada>[0]["data"]) => updFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e?.message ?? "Erro ao atualizar"),
  });

  const mutDel = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Entrada removida");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover"),
  });

  const lista = entradas ?? [];
  const resolvidas = lista.filter((e) => e.resultado === "green" || e.resultado === "red");
  const totalApostado = resolvidas.reduce((s, e) => s + e.valor, 0);
  const lucroTotal = lista.reduce((s, e) => s + lucroDe(e), 0);
  const roi = totalApostado > 0 ? (lucroTotal / totalApostado) * 100 : 0;
  const greens = lista.filter((e) => e.resultado === "green").length;
  const taxa = resolvidas.length > 0 ? (greens / resolvidas.length) * 100 : 0;

  const handleAdd = () => {
    mutAdd.mutate({
      data: form.data,
      descricao: form.descricao,
      valor: parseFloat(form.valor.replace(",", ".")) || 0,
      odd: parseFloat(form.odd.replace(",", ".")) || 1,
      resultado: form.resultado,
    });
  };

  const setResultado = (e: BancaEntrada, resultado: Resultado) => {
    mutUpd.mutate({
      id: e.id,
      data: e.data,
      descricao: e.descricao,
      valor: e.valor,
      odd: e.odd,
      resultado,
    });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <Wallet className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Gestão de Banca</h1>
        </div>

        {!liberado ? (
          <Card className="border-border/60 bg-card p-8 text-center">
            <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-semibold">Recurso dos planos Pro e Elite</h2>
            <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
              A Planilha de Gestão de Banca ajuda você a controlar apostas, lucro, ROI e taxa de
              acerto. Faça upgrade para liberar.
            </p>
            <Button onClick={() => router.navigate({ to: "/planos" })}>
              <Crown className="mr-2 h-4 w-4" /> Ver planos
            </Button>
          </Card>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard icon={TrendingUp} label="Lucro / Prejuízo" value={brl(lucroTotal)} accent={lucroTotal >= 0} />
              <StatCard icon={Target} label="Total apostado" value={brl(totalApostado)} />
              <StatCard icon={Percent} label="ROI" value={`${roi.toFixed(1)}%`} accent={roi >= 0} />
              <StatCard icon={Wallet} label="Taxa de acerto" value={`${taxa.toFixed(0)}%`} />
            </div>

            <Card className="mb-6 border-border/60 bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Nova entrada</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1 lg:col-span-1">
                  <Label className="text-xs">Data</Label>
                  <Input
                    type="date"
                    value={form.data}
                    onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-2">
                  <Label className="text-xs">Descrição / Evento</Label>
                  <Input
                    placeholder="Ex: Flamengo x Palmeiras - Over 2.5"
                    value={form.descricao}
                    onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.valor}
                    onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Odd</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="1.90"
                    value={form.odd}
                    onChange={(e) => setForm((f) => ({ ...f, odd: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Resultado</Label>
                  <select
                    value={form.resultado}
                    onChange={(e) => setForm((f) => ({ ...f, resultado: e.target.value as Resultado }))}
                    className="h-9 w-full rounded-md border border-border bg-input/40 px-2 text-sm"
                  >
                    {RESULTADOS.map((r) => (
                      <option key={r.v} value={r.v}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <Button size="sm" disabled={mutAdd.isPending} onClick={handleAdd}>
                  <Plus className="mr-2 h-4 w-4" /> Adicionar
                </Button>
              </div>
            </Card>

            <Card className="border-border/60 bg-card p-0">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : lista.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Nenhuma entrada ainda. Adicione sua primeira aposta acima.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="p-3">Data</th>
                        <th className="p-3">Descrição</th>
                        <th className="p-3 text-right">Valor</th>
                        <th className="p-3 text-right">Odd</th>
                        <th className="p-3">Resultado</th>
                        <th className="p-3 text-right">Lucro</th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((e) => {
                        const l = lucroDe(e);
                        return (
                          <tr key={e.id} className="border-b border-border/40">
                            <td className="whitespace-nowrap p-3 text-muted-foreground">
                              {new Date(e.data + "T00:00:00").toLocaleDateString("pt-BR")}
                            </td>
                            <td className="p-3">{e.descricao}</td>
                            <td className="p-3 text-right">{brl(e.valor)}</td>
                            <td className="p-3 text-right">{e.odd.toFixed(2)}</td>
                            <td className="p-3">
                              <select
                                value={e.resultado}
                                onChange={(ev) => setResultado(e, ev.target.value as Resultado)}
                                className="rounded-md border border-border bg-input/40 px-2 py-1 text-xs"
                              >
                                {RESULTADOS.map((r) => (
                                  <option key={r.v} value={r.v}>{r.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-3 text-right">
                              {e.resultado === "pendente" || e.resultado === "anulada" ? (
                                <Badge variant="secondary" className="text-[10px]">—</Badge>
                              ) : (
                                <span className={l >= 0 ? "text-primary" : "text-destructive"}>
                                  {brl(l)}
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => mutDel.mutate(e.id)}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
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
  value: string;
  accent?: boolean;
}) {
  return (
    <Card className="border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={accent ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"} />
      </div>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </Card>
  );
}
