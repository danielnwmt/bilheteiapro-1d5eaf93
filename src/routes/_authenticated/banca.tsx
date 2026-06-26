import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  listBancaEntradas,
  addBancaEntrada,
  deleteBancaEntrada,
  listBancaDepositos,
  addBancaDeposito,
  deleteBancaDeposito,
  type BancaEntrada,
  type Resultado,
} from "@/lib/banca.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Wallet,
  TrendingUp,
  Percent,
  CheckCircle2,
  CalendarIcon,
  Lock,
  Crown,
  PiggyBank,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAccess } from "@/hooks/useAccess";
import { usePlanos } from "@/hooks/usePlanos";
import { recursoLiberado } from "@/lib/planos";

export const Route = createFileRoute("/_authenticated/banca")({
  head: () => ({ meta: [{ title: "Gestão de Banca — BilheteIA PRO" }] }),
  component: BancaPage,
});




const RESULTADOS: { v: Resultado; label: string }[] = [
  { v: "pendente", label: "Pendente" },
  { v: "green", label: "Green (ganhou)" },
  { v: "red", label: "Red (perdeu)" },
  { v: "anulada", label: "Anulada" },
];

const ESPORTES: { v: string; label: string }[] = [
  { v: "futebol", label: "Futebol" },
  { v: "basquete", label: "Basquete" },
  { v: "tenis", label: "Tênis" },
  { v: "esports", label: "E-sports" },
];

const esporteLabel = (v: string) => ESPORTES.find((e) => e.v === v)?.label ?? v;

// Retorno (valor que volta) de uma entrada.
function retornoDe(e: { valor: number; odd: number; resultado: Resultado }) {
  if (e.resultado === "green") return e.valor * e.odd;
  if (e.resultado === "red") return 0;
  if (e.resultado === "anulada") return e.valor; // reembolso
  return null; // pendente
}

// Lucro líquido (retorno - valor apostado) já resolvido.
function lucroDe(e: { valor: number; odd: number; resultado: Resultado }) {
  if (e.resultado === "green") return e.valor * (e.odd - 1);
  if (e.resultado === "red") return -e.valor;
  return 0; // pendente / anulada não impactam o lucro
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function statusBadge(r: Resultado) {
  switch (r) {
    case "pendente":
      return (
        <Badge className="border-yellow-500/30 bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/15">
          Pendente
        </Badge>
      );
    case "green":
      return (
        <Badge className="border-green-500/30 bg-green-500/15 text-green-500 hover:bg-green-500/15">
          Green
        </Badge>
      );
    case "red":
      return (
        <Badge className="border-red-500/30 bg-red-500/15 text-red-500 hover:bg-red-500/15">
          Red
        </Badge>
      );
    case "anulada":
      return (
        <Badge className="border-muted-foreground/20 bg-muted text-muted-foreground hover:bg-muted">
          Anulada
        </Badge>
      );
  }
}

function BancaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: access } = useAccess();
  const { byPlano } = usePlanos();
  const planoCfg = access?.plano ? byPlano?.[access.plano] : null;
  const liberado = recursoLiberado(planoCfg, "planilhaBanca");

  const fetchEntradas = useServerFn(listBancaEntradas);
  const addFn = useServerFn(addBancaEntrada);
  const delFn = useServerFn(deleteBancaEntrada);
  const fetchDepositos = useServerFn(listBancaDepositos);
  const addDepFn = useServerFn(addBancaDeposito);
  const delDepFn = useServerFn(deleteBancaDeposito);

  const [dataAposta, setDataAposta] = useState<Date>(new Date());
  const [calOpen, setCalOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [tipoAposta, setTipoAposta] = useState("simples");
  const [esporte, setEsporte] = useState("futebol");
  const [valor, setValor] = useState("");
  const [odd, setOdd] = useState("");
  const [resultado, setResultado] = useState<Resultado>("pendente");

  const [depOpen, setDepOpen] = useState(false);
  const [depValor, setDepValor] = useState("");
  const [depDescricao, setDepDescricao] = useState("");

  const { data: entradas, isLoading } = useQuery({
    queryKey: ["banca"],
    queryFn: () => fetchEntradas(),
    enabled: liberado,
  });

  const { data: depositos } = useQuery({
    queryKey: ["banca-depositos"],
    queryFn: () => fetchDepositos(),
    enabled: liberado,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["banca"] });
  const invalidateDep = () => qc.invalidateQueries({ queryKey: ["banca-depositos"] });

  const mutAdd = useMutation({
    mutationFn: (v: Parameters<typeof addBancaEntrada>[0]["data"]) => addFn({ data: v }),
    onSuccess: () => {
      toast.success("Entrada adicionada");
      setDescricao("");
      setEsporte("futebol");
      setValor("");
      setOdd("");
      setResultado("pendente");
      setDataAposta(new Date());
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao adicionar"),
  });

  const mutDel = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Entrada removida");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover"),
  });

  const mutAddDep = useMutation({
    mutationFn: (v: Parameters<typeof addBancaDeposito>[0]["data"]) => addDepFn({ data: v }),
    onSuccess: () => {
      toast.success("Dinheiro adicionado à banca");
      setDepValor("");
      setDepDescricao("");
      setDepOpen(false);
      invalidateDep();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao adicionar"),
  });

  const mutDelDep = useMutation({
    mutationFn: (id: string) => delDepFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Aporte removido");
      invalidateDep();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover"),
  });

  const lista = entradas ?? [];
  const listaDep = depositos ?? [];
  const resolvidas = lista.filter((e) => e.resultado === "green" || e.resultado === "red");
  const totalApostado = resolvidas.reduce((s, e) => s + e.valor, 0);
  const lucroTotal = lista.reduce((s, e) => s + lucroDe(e), 0);
  const totalDepositado = listaDep.reduce((s, d) => s + d.valor, 0);
  const bancaAtual = totalDepositado + lucroTotal;
  const roi = totalApostado > 0 ? (lucroTotal / totalApostado) * 100 : 0;
  const greens = lista.filter((e) => e.resultado === "green").length;
  const taxa = resolvidas.length > 0 ? (greens / resolvidas.length) * 100 : 0;

  const handleAdd = () => {
    mutAdd.mutate({
      data: format(dataAposta, "yyyy-MM-dd"),
      descricao,
      esporte,
      valor: parseFloat(valor.replace(",", ".")) || 0,
      odd: parseFloat(odd.replace(",", ".")) || 1,
      resultado,
    });
  };

  const handleAddDep = () => {
    mutAddDep.mutate({
      data: new Date().toISOString().slice(0, 10),
      descricao: depDescricao,
      valor: parseFloat(depValor.replace(",", ".")) || 0,
    });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
        </div>

        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Gestão de Banca</h1>
          </div>
          {liberado && (
            <Dialog open={depOpen} onOpenChange={setDepOpen}>
              <DialogTrigger asChild>
                <Button className="bg-green-600 text-white hover:bg-green-700">
                  <PiggyBank className="mr-2 h-4 w-4" /> Adicionar dinheiro
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Adicionar dinheiro à banca</DialogTitle>
                  <DialogDescription>
                    Registre um aporte (depósito) que entra na sua banca.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor (R$)</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={depValor}
                      onChange={(e) => setDepValor(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição (opcional)</Label>
                    <Input
                      placeholder="Ex: Aporte inicial, recarga..."
                      value={depDescricao}
                      onChange={(e) => setDepDescricao(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    className="bg-green-600 text-white hover:bg-green-700"
                    disabled={mutAddDep.isPending}
                    onClick={handleAddDep}
                  >
                    {mutAddDep.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Adicionar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
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
            {/* Cards de indicadores */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Wallet}
                label="Banca Atual"
                value={brl(bancaAtual)}
                hint={`Depositado ${brl(totalDepositado)}`}
              />

              <StatCard
                icon={TrendingUp}
                label="Lucro / Prejuízo"
                value={brl(lucroTotal)}
                tone={lucroTotal > 0 ? "pos" : lucroTotal < 0 ? "neg" : "neutral"}
              />
              <StatCard
                icon={Percent}
                label="ROI"
                value={`${roi.toFixed(1)}%`}
                tone={roi > 0 ? "pos" : roi < 0 ? "neg" : "neutral"}
              />
              <StatCard
                icon={CheckCircle2}
                label="Taxa de Acerto"
                value={`${taxa.toFixed(0)}%`}
                hint={`${greens}/${resolvidas.length} finalizadas`}
              />
            </div>

            {/* Formulário nova entrada */}
            <Card className="mb-8 border-border/60 bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Nova entrada</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
                <div className="space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">Data</Label>
                  <Popover open={calOpen} onOpenChange={setCalOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dataAposta && "text-muted-foreground",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dataAposta ? format(dataAposta, "dd/MM/yyyy") : "Selecionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dataAposta}
                        onSelect={(d) => {
                          if (d) setDataAposta(d);
                          setCalOpen(false);
                        }}
                        initialFocus
                        locale={ptBR}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                  <Label className="text-xs">Descrição / Evento</Label>
                  <Input
                    placeholder="Ex: Flamengo x Palmeiras - Over 2.5"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 lg:col-span-2">
                  <Label className="text-xs">Esporte</Label>
                  <Select value={esporte} onValueChange={setEsporte}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ESPORTES.map((e) => (
                        <SelectItem key={e.v} value={e.v}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5 lg:col-span-1">
                  <Label className="text-xs">Valor (R$)</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 lg:col-span-1">
                  <Label className="text-xs">Odd</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="1.90"
                    value={odd}
                    onChange={(e) => setOdd(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5 lg:col-span-3">
                  <Label className="text-xs">Resultado</Label>
                  <Select value={resultado} onValueChange={(v) => setResultado(v as Resultado)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULTADOS.map((r) => (
                        <SelectItem key={r.v} value={r.v}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4">
                <Button
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={mutAdd.isPending}
                  onClick={handleAdd}
                >
                  {mutAdd.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Adicionar
                </Button>
              </div>
            </Card>

            {/* Aportes na banca */}
            {listaDep.length > 0 && (
              <Card className="mb-8 border-border/60 bg-card p-5">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <PiggyBank className="h-4 w-4" /> Aportes na banca
                </h2>
                <div className="space-y-2">
                  {listaDep.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {new Date(d.data + "T00:00:00").toLocaleDateString("pt-BR")}
                        </span>
                        <span>{d.descricao}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-green-500">+{brl(d.valor)}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => mutDelDep.mutate(d.id)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}



            {/* Histórico */}
            <Card className="border-border/60 bg-card p-0">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : lista.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Nenhuma entrada ainda. Adicione sua primeira aposta acima.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Esporte</TableHead>
                      <TableHead className="text-right">Valor (R$)</TableHead>
                      <TableHead className="text-right">Odd</TableHead>
                      <TableHead className="text-right">Retorno (R$)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lista.map((e: BancaEntrada) => {
                      const ret = retornoDe(e);
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {new Date(e.data + "T00:00:00").toLocaleDateString("pt-BR")}
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate">{e.descricao}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {esporteLabel(e.esporte)}
                          </TableCell>
                          <TableCell className="text-right">{brl(e.valor)}</TableCell>
                          <TableCell className="text-right">{e.odd.toFixed(2)}</TableCell>
                          <TableCell className="text-right">
                            {ret === null ? (
                              <span className="text-muted-foreground">-</span>
                            ) : (
                              <span
                                className={
                                  e.resultado === "green"
                                    ? "text-green-500"
                                    : e.resultado === "red"
                                      ? "text-red-500"
                                      : "text-muted-foreground"
                                }
                              >
                                {brl(ret)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>{statusBadge(e.resultado)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => mutDel.mutate(e.id)}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
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
  hint,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  const valueColor =
    tone === "pos" ? "text-green-500" : tone === "neg" ? "text-red-500" : "text-foreground";
  const iconColor =
    tone === "pos"
      ? "text-green-500"
      : tone === "neg"
        ? "text-red-500"
        : "text-muted-foreground";
  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <p className={cn("mt-2 text-2xl font-bold tracking-tight", valueColor)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
