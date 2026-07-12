import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getMelhoresPicks, type MelhorPick } from "@/lib/melhores-picks.functions";
import { addFavorito } from "@/lib/favoritos.functions";
import { useAccess } from "@/hooks/useAccess";
import { usePlanos } from "@/hooks/usePlanos";
import { recursoLiberado } from "@/lib/planos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Flame, Star, TrendingUp, RefreshCw, Trophy, CalendarDays, Target, Crown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/melhores-picks")({
  head: () => ({ meta: [{ title: "Melhores Picks do Dia — BilheteIA PRO" }] }),
  component: MelhoresPicksPage,
});

function Estrelas({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < n ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

function corValor(label: string | null) {
  if (label === "Excelente Valor") return "default";
  if (label === "Bom Valor") return "secondary";
  return "outline";
}

function MelhoresPicksPage() {
  const router = useRouter();
  const [limite] = useState(12);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["melhores-picks", limite],
    queryFn: () => getMelhoresPicks({ data: { limite, minConfianca: 70 } }),
  });

  const mFav = useMutation({
    mutationFn: (p: MelhorPick) =>
      addFavorito({
        data: {
          tipo: "jogo",
          valor: p.jogo,
          rotulo: `${p.mercado}: ${p.selecao}`,
          metadata: { mercado: p.mercado, selecao: p.selecao, odd: p.odd, liga: p.liga },
        },
      }),
    onSuccess: () => toast.success("Adicionado aos favoritos"),
    onError: (e: any) => toast.error(e.message ?? "Erro ao favoritar"),
  });

  const picks = data?.picks ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Flame className="h-6 w-6 text-primary" /> Melhores Picks do Dia
            </h1>
            <p className="text-sm text-muted-foreground">
              As seleções com melhor valor e confiança dos jogos de hoje, direto do robô de análise.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando os melhores picks...
        </div>
      ) : picks.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Target className="h-8 w-8" />
          <p className="font-medium">Nenhum pick disponível agora</p>
          <p className="max-w-sm text-sm">
            O robô ainda está preparando as análises dos jogos de hoje ou não há jogos liberados no seu plano. Tente
            novamente em alguns minutos.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {picks.map((p, i) => (
            <Card key={`${p.partidaId}-${i}`} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="truncate font-semibold">{p.jogo}</span>
                    {p.liga && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Trophy className="h-3 w-3" /> {p.liga}
                      </Badge>
                    )}
                    <Badge variant="outline" className="gap-1 text-xs">
                      <CalendarDays className="h-3 w-3" /> {p.data}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{p.mercado}:</span>{" "}
                    <span className="font-medium">{p.selecao}</span>
                  </p>
                  {p.justificativa && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.justificativa}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Estrelas n={p.estrelas} />
                    {p.valorLabel && <Badge variant={corValor(p.valorLabel)}>{p.valorLabel}</Badge>}
                    {p.evPct !== null && (
                      <span
                        className={`flex items-center gap-1 text-xs font-medium ${
                          p.evPct >= 0 ? "text-emerald-500" : "text-muted-foreground"
                        }`}
                      >
                        <TrendingUp className="h-3 w-3" /> EV {p.evPct >= 0 ? "+" : ""}
                        {p.evPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:flex-col sm:items-end">
                  <div className="text-right">
                    <div className="text-2xl font-bold">{p.odd.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{p.confianca}% confiança</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => mFav.mutate(p)}
                    disabled={mFav.isPending}
                  >
                    <Star className="mr-1.5 h-3.5 w-3.5" /> Favoritar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
