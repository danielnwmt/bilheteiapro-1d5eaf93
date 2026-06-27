import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, X, Loader2, ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import {
  TODAS_LIGAS,
  RECURSO_LABELS,
  CICLO_LABEL,
  CICLO_MESES,
  descontoDoCiclo,
  precoCicloCentavos,
  precoMensalEquivalenteCentavos,
  formatarReais,
  type Ciclo,
  type Plano,
} from "@/lib/planos";
import { usePlanos } from "@/hooks/usePlanos";
import { createAsaasCheckout, cancelarAssinatura } from "@/lib/payments.functions";
import { useAccess } from "@/hooks/useAccess";
import { CartaoPagamento } from "@/components/CartaoPagamento";

export const Route = createFileRoute("/_authenticated/planos")({
  head: () => ({
    meta: [
      { title: "Planos — BilheteIA PRO" },
      { name: "description", content: "Escolha o plano BilheteIA: Start, Pro ou Elite." },
    ],
  }),
  component: PlanosPage,
});

function Cell({ value }: { value: boolean | string }) {
  if (typeof value === "string")
    return <span className="text-sm font-semibold">{value}</span>;
  return value ? (
    <Check className="mx-auto h-5 w-5 text-primary" />
  ) : (
    <X className="mx-auto h-5 w-5 text-destructive/70" />
  );
}

function PlanosPage() {
  const router = useRouter();
  const { data: access } = useAccess();
  const { list, byPlano, isLoading } = usePlanos();
  const [checkout, setCheckout] = useState<Plano | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ciclo, setCiclo] = useState<Ciclo>("mensal");
  const [telaCartao, setTelaCartao] = useState(false);

  const asaasCheckout = useServerFn(createAsaasCheckout);

  const planoAtual = access?.plano ?? null;
  const checkoutCfg = checkout ? byPlano[checkout] : null;

  async function pagar(metodo: "pix" | "cartao") {
    if (!checkout) return;
    setCarregando(true);
    try {
      const returnUrl = `${window.location.origin}/?checkout=success`;
      const result = await asaasCheckout({ data: { plano: checkout, ciclo, returnUrl, metodo } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.url;
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível iniciar o pagamento");
    } finally {
      setCarregando(false);
    }
  }

  const linhas: Array<{ recurso: string; start: boolean | string; pro: boolean | string; elite: boolean | string }> = [
    ...TODAS_LIGAS.map((liga) => ({
      recurso: liga,
      start: !!byPlano.start?.ligas.includes(liga),
      pro: !!byPlano.pro?.ligas.includes(liga),
      elite: !!byPlano.elite?.ligas.includes(liga),
    })),
    ...RECURSO_LABELS.map((r) => ({
      recurso: r.label,
      start: !!byPlano.start?.recursos[r.key],
      pro: !!byPlano.pro?.recursos[r.key],
      elite: !!byPlano.elite?.recursos[r.key],
    })),
    {
      recurso: "Histórico",
      start: byPlano.start ? `${byPlano.start.historicoDias} dias` : "-",
      pro: byPlano.pro ? `${byPlano.pro.historicoDias} dias` : "-",
      elite: byPlano.elite ? `${byPlano.elite.historicoDias} dias` : "-",
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10 md:py-14">
        <div className="mb-8 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold md:text-4xl">Escolha seu plano</h1>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            Libere mais ligas e recursos conforme o plano. Cancele quando quiser.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <div className="inline-flex rounded-full border border-border/60 bg-card p-1">
            {(["mensal", "semestral", "anual"] as Ciclo[]).map((c) => {
              const ativo = ciclo === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCiclo(c)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    ativo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {CICLO_LABEL[c]}
                </button>
              );
            })}
          </div>
        </div>
        {ciclo !== "mensal" && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Pagamento único a cada {CICLO_MESES[ciclo]} meses.
          </p>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : checkout && checkoutCfg && telaCartao ? (
          <CartaoPagamento
            plano={checkout}
            ciclo={ciclo}
            precoCentavos={precoCicloCentavos(checkoutCfg, ciclo)}
            precoLabel={formatarReais(precoCicloCentavos(checkoutCfg, ciclo))}
            onSucesso={() => router.navigate({ to: "/" })}
            onCancelar={() => setTelaCartao(false)}
          />
        ) : checkout && checkoutCfg ? (
          <Card className="mx-auto mt-8 max-w-md border-border/60 bg-card p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{checkoutCfg.nome}</h2>
              <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>
                Cancelar
              </Button>
            </div>
            <p className="text-2xl font-bold">
              {formatarReais(precoCicloCentavos(checkoutCfg, ciclo))}
              <span className="text-sm font-normal text-muted-foreground">
                /{CICLO_LABEL[ciclo].toLowerCase()}
              </span>
            </p>
            {ciclo !== "mensal" && (
              <p className="mt-1 text-sm text-muted-foreground">
                Equivale a {formatarReais(precoMensalEquivalenteCentavos(checkoutCfg, ciclo))}/mês
                {descontoDoCiclo(checkoutCfg, ciclo) > 0 && (
                  <span className="ml-1 font-semibold text-primary">
                    ({descontoDoCiclo(checkoutCfg, ciclo)}% off)
                  </span>
                )}
              </p>
            )}
            <p className="mt-4 mb-3 text-sm text-muted-foreground">
              Escolha a forma de pagamento.
            </p>
            <div className="space-y-3">
              <Button
                className="w-full font-semibold"
                disabled={carregando}
                onClick={() => pagar("pix")}
              >
                {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Pagar com Pix
              </Button>
              <Button
                variant="outline"
                className="w-full font-semibold"
                disabled={carregando}
                onClick={() => setTelaCartao(true)}
              >
                Crédito / Débito
              </Button>
            </div>
          </Card>

        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {list.map((info) => {
              const p = info.plano;
              const atual = planoAtual === p;
              return (
                <Card
                  key={p}
                  className={`flex flex-col border-border/60 bg-card p-6 ${
                    p === "pro" ? "ring-1 ring-primary" : ""
                  }`}
                >
                  {p === "pro" && <Badge className="mb-2 w-fit">Mais popular</Badge>}
                  <h3 className="text-lg font-bold">{info.nome}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{info.descricao}</p>
                  <p className="mt-4 text-3xl font-bold">
                    {formatarReais(precoCicloCentavos(info, ciclo))}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{CICLO_LABEL[ciclo].toLowerCase()}
                    </span>
                  </p>
                  {ciclo !== "mensal" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatarReais(precoMensalEquivalenteCentavos(info, ciclo))}/mês
                      {descontoDoCiclo(info, ciclo) > 0 && (
                        <span className="ml-1 font-semibold text-primary">
                          {descontoDoCiclo(info, ciclo)}% off
                        </span>
                      )}
                    </p>
                  )}
                  <Button
                    className="mt-6 w-full font-semibold"
                    variant={p === "pro" ? "default" : "outline"}
                    disabled={atual}
                    onClick={() => { setTelaCartao(false); setCheckout(p); }}
                  >
                    {atual ? "Plano atual" : "Assinar"}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}

        <Card className="mt-10 overflow-hidden border-border/60 bg-card">
          <div className="border-b border-border/60 p-5">
            <h2 className="text-lg font-bold">Comparativo</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/60 text-sm">
                  <th className="p-4 font-semibold">Recursos</th>
                  <th className="p-4 text-center font-semibold">Start</th>
                  <th className="p-4 text-center font-semibold">Pro</th>
                  <th className="p-4 text-center font-semibold">Elite</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((row) => (
                  <tr key={row.recurso} className="border-b border-border/40 text-sm">
                    <td className="p-4">{row.recurso}</td>
                    <td className="p-4 text-center"><Cell value={row.start} /></td>
                    <td className="p-4 text-center"><Cell value={row.pro} /></td>
                    <td className="p-4 text-center"><Cell value={row.elite} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}
