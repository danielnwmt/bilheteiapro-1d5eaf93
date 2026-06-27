import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/bilheteia-logo.png";

export const Route = createFileRoute("/reset-password")({
  ssr: "data-only",
  head: () => ({
    meta: [
      { title: "Redefinir senha — BilheteIA PRO" },
      { name: "description", content: "Defina uma nova senha para sua conta." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirma) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      toast.success("Senha redefinida com sucesso!");
      router.navigate({ to: "/", replace: true });
    } catch {
      toast.error("Não foi possível redefinir a senha. Solicite um novo link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Card className="border-border/60 bg-card p-6 md:p-8">
          <img src={logo} alt="BilheteIA PRO" className="mx-auto mb-6 w-40 max-w-full" />
          <p className="text-center text-sm text-muted-foreground">
            {ready
              ? "Defina uma nova senha para sua conta."
              : "Abra esta página pelo link enviado ao seu e-mail."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="senha" className="mb-2 block text-sm">Nova senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="bg-input/40"
                disabled={!ready}
              />
            </div>
            <div>
              <Label htmlFor="confirma" className="mb-2 block text-sm">Confirmar senha</Label>
              <Input
                id="confirma"
                type="password"
                autoComplete="new-password"
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                className="bg-input/40"
                disabled={!ready}
              />
            </div>
            <Button type="submit" disabled={loading || !ready} size="lg" className="w-full font-semibold">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aguarde...</>
              ) : "Redefinir senha"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
