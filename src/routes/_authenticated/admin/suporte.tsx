import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Save, ShieldAlert, LifeBuoy } from "lucide-react";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { getSuporte, setSystemConfig } from "@/lib/access.functions";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/suporte")({
  head: () => ({ meta: [{ title: "Suporte — Admin BilheteIA" }] }),
  component: SuportePage,
});

function SuportePage() {
  const router = useRouter();
  const { data: access } = useAccess();
  const [currentEmail, setCurrentEmail] = useState("");
  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const carregarSuporte = useServerFn(getSuporte);
  const salvarConfig = useServerFn(setSystemConfig);
  const [suporte, setSuporte] = useState({ whatsapp: "", email: "", mensagem: "" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
    });
  }, []);

  useEffect(() => {
    carregarSuporte()
      .then((s) =>
        setSuporte({
          whatsapp: s.whatsapp ?? "",
          email: s.email ?? "",
          mensagem: s.mensagem ?? "",
        }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suporteMut = useMutation({
    mutationFn: async () => {
      await salvarConfig({
        data: { chave: "SUPORTE_WHATSAPP", valor: suporte.whatsapp.trim(), descricao: "WhatsApp de suporte" },
      });
      await salvarConfig({
        data: { chave: "SUPORTE_EMAIL", valor: suporte.email.trim(), descricao: "E-mail de suporte" },
      });
      await salvarConfig({
        data: { chave: "SUPORTE_MENSAGEM", valor: suporte.mensagem.trim(), descricao: "Mensagem padrão de suporte" },
      });
    },
    onSuccess: () => toast.success("Dados de suporte salvos"),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar suporte"),
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <LifeBuoy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Suporte</h1>
        </div>

        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem editar os dados de suporte.
          </Card>
        ) : (
          <Card className="border-border/60 bg-card p-6">
            <div className="mb-4 flex items-center justify-end">
              <Button size="sm" disabled={suporteMut.isPending} onClick={() => suporteMut.mutate()}>
                {suporteMut.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Estes dados são usados no botão de suporte que aparece para os clientes.
            </p>
            <div className="grid gap-4">
              <div>
                <Label className="mb-1 block text-sm">WhatsApp (com DDD e país)</Label>
                <Input
                  value={suporte.whatsapp}
                  onChange={(e) => setSuporte((s) => ({ ...s, whatsapp: e.target.value }))}
                  placeholder="Ex: 5511999999999"
                />
              </div>
              <div>
                <Label className="mb-1 block text-sm">E-mail</Label>
                <Input
                  value={suporte.email}
                  onChange={(e) => setSuporte((s) => ({ ...s, email: e.target.value }))}
                  placeholder="suporte@seudominio.com"
                />
              </div>
              <div>
                <Label className="mb-1 block text-sm">Mensagem padrão (opcional)</Label>
                <Input
                  value={suporte.mensagem}
                  onChange={(e) => setSuporte((s) => ({ ...s, mensagem: e.target.value }))}
                  placeholder="Olá! Preciso de ajuda com..."
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
