import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listFavoritos,
  addFavorito,
  removeFavorito,
  type Favorito,
  type TipoFavorito,
} from "@/lib/favoritos.functions";
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
import { ArrowLeft, Loader2, Plus, Star, Trash2, Trophy, CalendarDays, Target, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/favoritos")({
  head: () => ({ meta: [{ title: "Favoritos — BilheteIA PRO" }] }),
  component: FavoritosPage,
});

const TIPOS: { v: TipoFavorito; label: string; icon: React.ReactNode }[] = [
  { v: "campeonato", label: "Campeonato", icon: <Trophy className="h-4 w-4" /> },
  { v: "jogo", label: "Jogo", icon: <CalendarDays className="h-4 w-4" /> },
  { v: "mercado", label: "Mercado", icon: <Target className="h-4 w-4" /> },
  { v: "time", label: "Time", icon: <Users className="h-4 w-4" /> },
  { v: "bilhete", label: "Bilhete", icon: <Star className="h-4 w-4" /> },
];

function iconePara(tipo: TipoFavorito) {
  return TIPOS.find((t) => t.v === tipo)?.icon ?? <Star className="h-4 w-4" />;
}

function FavoritosPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<TipoFavorito>("campeonato");
  const [valor, setValor] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["favoritos"], queryFn: () => listFavoritos() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["favoritos"] });

  const mAdd = useMutation({
    mutationFn: () => addFavorito({ data: { tipo, valor: valor.trim() } }),
    onSuccess: () => {
      setValor("");
      toast.success("Favorito adicionado");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao adicionar"),
  });
  const mRemove = useMutation({
    mutationFn: (id: string) => removeFavorito({ data: { id } }),
    onSuccess: invalidate,
  });

  const favoritos = data ?? [];
  const porTipo = (t: TipoFavorito) => favoritos.filter((f) => f.tipo === t);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 truncate text-2xl font-black sm:text-3xl">
            <Star className="h-6 w-6 shrink-0 fill-yellow-400 text-yellow-400" /> Favoritos
          </h1>
          <p className="text-sm text-muted-foreground">O sistema prioriza seus favoritos nas sugestões</p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => router.navigate({ to: "/" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Início
        </Button>
      </header>

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFavorito)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS.map((t) => (
                <SelectItem key={t.v} value={t.v}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="flex-1"
            placeholder="Nome (ex.: Brasileirão, Flamengo, Mais de 2.5...)"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valor.trim() && mAdd.mutate()}
          />
          <Button onClick={() => mAdd.mutate()} disabled={!valor.trim() || mAdd.isPending}>
            {mAdd.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />} Adicionar
          </Button>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : favoritos.length === 0 ? (
        <Card className="border-dashed p-10 text-center text-sm text-muted-foreground">
          Você ainda não tem favoritos. Adicione campeonatos, times e mercados que você mais aposta.
        </Card>
      ) : (
        <div className="space-y-4">
          {TIPOS.map((t) => {
            const itens = porTipo(t.v);
            if (!itens.length) return null;
            return (
              <Card key={t.v} className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  {t.icon} {t.label}s
                </h2>
                <div className="flex flex-wrap gap-2">
                  {itens.map((f: Favorito) => (
                    <Badge key={f.id} variant="secondary" className="gap-1.5 py-1.5 pl-3 pr-1.5 text-sm">
                      {iconePara(f.tipo)}
                      {f.rotulo ?? f.valor}
                      <button
                        className="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
                        onClick={() => mRemove.mutate(f.id)}
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
