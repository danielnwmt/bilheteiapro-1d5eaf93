import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2, ArrowLeft } from "lucide-react";
import { PLANOS, PLANO_INFO, COMPARATIVO, type Plano } from "@/lib/planos";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { useAccess } from "@/hooks/useAccess";

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
  const [checkout, setCheckout] = useState<Plano | null>(null);

  const planoAtual = access?.plano ?? null;

  return (
    <main className="min-h-screen bg-background">
      <PaymentTestModeBanner />
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

        {checkout ? (
          <Card className="mx-auto mt-8 max-w-2xl border-border/60 bg-card p-4 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{PLANO_INFO[checkout].nome}</h2>
              <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>
                Cancelar
              </Button>
            </div>
            <StripeEmbeddedCheckout
              priceId={PLANO_INFO[checkout].priceId}
              returnUrl={`${window.location.origin}/?checkout=success`}
            />
          </Card>
        ) : (
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PLANOS.map((p) => {
              const info = PLANO_INFO[p];
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
                    {info.preco}
                    <span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </p>
                  <Button
                    className="mt-6 w-full font-semibold"
                    variant={p === "pro" ? "default" : "outline"}
                    disabled={atual}
                    onClick={() => setCheckout(p)}
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
                {COMPARATIVO.map((row) => (
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
