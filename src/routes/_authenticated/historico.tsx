import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listHistorico,
  updateHistorico,
  deleteHistorico,
  duplicarHistorico,
  type HistoricoBilhete,
  type ResultadoHistorico,
} from "@/lib/historico.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { ArrowLeft, Loader2, Search, Download, Copy, Trash2, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({ meta: [{ title: "Histórico — BilheteIA PRO" }] }),
  component: HistoricoPage,
});

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

const RESULTADOS: { v: ResultadoHistorico | "todos"; label: string }[] = [
  { v: "todos", label: "Todos" },
  { v: "pendente", label: "Pendentes" },
  { v: "green", label: "Green" },
  { v: "red", label: "Red" },
  { v: "void", label: "Void" },
];

function badge(r: ResultadoHistorico) {
  if (r === "green") return <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Green</Badge>;
  if (r === "red") return <Badge className="bg-rose-500/15 text-rose-500 hover:bg-rose-500/15">Red</Badge>;
  if (r === "void") return <Badge variant="secondary">Void</Badge>;
  return <Badge variant="outline">Pendente</Badge>;
}

function HistoricoPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<ResultadoHistorico | "todos">("todos");

  const { data, isLoading } = useQuery({ queryKey: ["historico"], queryFn: () => listHistorico() });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["historico"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const mResultado = useMutation({
    mutationFn: (v: { id: string; resultado: ResultadoHistorico }) => updateHistorico({ data: v }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar"),
  });
  const mDelete = useMutation({
    mutationFn: (id: string) => deleteHistorico({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido do histórico");
      invalidate();
    },
  });
  const mDuplicar = useMutation({
    mutationFn: (id: string) => duplicarHistorico({ data: { id } }),
    onSuccess: () => {
      toast.success("Bilhete duplicado");
      invalidate();
    },
  });

  const filtrados = useMemo(() => {
    const lista = data ?? [];
    const termo = busca.trim().toLowerCase();
    return lista.filter((h) => {
      if (filtro !== "todos" && h.resultado !== filtro) return false;
      if (!termo) return true;
      return (
        h.jogos.toLowerCase().includes(termo) ||
        h.mercados.toLowerCase().includes(termo) ||
        (h.casa ?? "").toLowerCase().includes(termo) ||
        (h.observacoes ?? "").toLowerCase().includes(termo)
      );
    });
  }, [data, busca, filtro]);

  const exportarCSV = () => {
    const linhas = [
      ["Data", "Jogos", "Mercados", "Tipo", "Casa", "Odd", "Stake", "Retorno", "Resultado", "Observações"],
      ...filtrados.map((h) => [
        h.data_evento,
        h.jogos,
        h.mercados,
        h.tipo,
        h.casa ?? "",
        String(h.odd_total),
        String(h.stake),
        String(h.retorno),
        h.resultado,
        h.observacoes ?? "",
      ]),
    ];
    const csv = linhas
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-2xl font-black sm:text-3xl">
            <HistoryIcon className="h-6 w-6 shrink-0" /> Histórico
          </h1>
          <p className="text-sm text-muted-foreground">Todos os seus bilhetes registrados</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={exportarCSV} disabled={!filtrados.length}>
            <Download className="mr-2 h-4 w-4" /> Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Início
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por jogo, mercado, casa..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select value={filtro} onValueChange={(v) => setFiltro(v as any)}>
          <SelectTrigger className="w-full sm:w-40">
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

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtrados.length === 0 ? (
        <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum bilhete no histórico ainda.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Jogos / Mercados</TableHead>
                <TableHead className="text-right">Odd</TableHead>
                <TableHead className="text-right">Stake</TableHead>
                <TableHead className="text-right">Retorno</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((h: HistoricoBilhete) => (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap text-xs">{h.data_evento}</TableCell>
                  <TableCell className="max-w-xs">
                    <p className="truncate text-sm font-medium">{h.jogos || "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">{h.mercados}</p>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{h.odd_total.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{brl(h.stake)}</TableCell>
                  <TableCell className="text-right">{brl(h.retorno)}</TableCell>
                  <TableCell>
                    <Select
                      value={h.resultado}
                      onValueChange={(v) => mResultado.mutate({ id: h.id, resultado: v as ResultadoHistorico })}
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pendente">Pendente</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                        <SelectItem value="void">Void</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => mDuplicar.mutate(h.id)} title="Duplicar">
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => mDelete.mutate(h.id)} title="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
