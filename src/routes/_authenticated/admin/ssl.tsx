import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestSsl, getSslStatus } from "@/lib/ssl.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/ssl")({
  head: () => ({ meta: [{ title: "Certificado SSL — Admin BilheteIA" }] }),
  component: SslPage,
});

function SslPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const instalar = useServerFn(requestSsl);
  const fetchStatus = useServerFn(getSslStatus);
  const [dominio, setDominio] = useState("");
  const [email, setEmail] = useState("");

  const { data: status } = useQuery({
    queryKey: ["ssl-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 5000,
  });

  const mut = useMutation({
    mutationFn: () => instalar({ data: { dominio, email } }),
    onSuccess: (res: any) => {
      toast.success(
        res?.watcher
          ? "Instalação do SSL iniciada! Aguarde 1-2 minutos."
          : "Pedido de SSL enviado. Aguarde o status atualizar em alguns minutos.",
        { duration: 9000 },
      );
      qc.invalidateQueries({ queryKey: ["ssl-status"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao solicitar SSL", { duration: 12000 }),
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => router.navigate({ to: "/admin" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Painel
        </Button>

        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Certificado SSL (HTTPS)</h1>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Instale um certificado gratuito (Let's Encrypt) no seu servidor. O domínio precisa estar
          apontado para o IP da VPS e as portas 80 e 443 livres.
        </p>

        <Card className="border-border/60 bg-card p-5">
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-semibold">Domínio</Label>
              <Input
                placeholder="meusite.com.br"
                value={dominio}
                onChange={(e) => setDominio(e.target.value.toLowerCase().trim())}
                className="mt-1 bg-input/40"
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">E-mail (avisos de renovação)</Label>
              <Input
                type="email"
                placeholder="voce@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                className="mt-1 bg-input/40"
              />
            </div>
            <Button className="w-full" disabled={mut.isPending || !dominio || !email} onClick={() => mut.mutate()}>
              {mut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Instalar SSL
            </Button>
          </div>
        </Card>

        {status?.status ? (
          <Card className="mt-4 border-border/60 bg-card p-4">
            <Label className="text-sm font-semibold">Status</Label>
            <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{status.status}</p>
          </Card>
        ) : null}

        <Card className="mt-4 border-dashed border-border/60 bg-card p-4 text-xs text-muted-foreground">
          <p className="mb-1 font-semibold text-foreground">Como funciona</p>
          O painel solicita ao servidor a emissão do certificado via certbot. A renovação é automática.
          Se o domínio ainda não estiver propagado, aguarde alguns minutos e tente novamente.
        </Card>
      </div>
    </main>
  );
}
