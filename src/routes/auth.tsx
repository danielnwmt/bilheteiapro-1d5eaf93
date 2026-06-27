import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/bilheteia-logo.png";
import { checkEmailExists } from "@/lib/auth-check.functions";
import { bootstrapDefaultAdmin, ensureAdmin } from "@/lib/admin-bootstrap.functions";

export const Route = createFileRoute("/auth")({
  ssr: "data-only",
  head: () => ({
    meta: [
      { title: "Entrar — BilheteIA PRO" },
      { name: "description", content: "Acesse sua conta BilheteIA PRO." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [telefone, setTelefone] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) router.navigate({ to: "/", replace: true });
    });
  }, [router]);

  function formatCpf(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }

  function formatTelefone(v: string) {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 10) {
      return d
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
    }
    return d
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup") {
      const cpfDigits = cpf.replace(/\D/g, "");
      const telDigits = telefone.replace(/\D/g, "");
      if (!nome.trim() || cpfDigits.length !== 11 || !nascimento || telDigits.length < 10) {
        toast.error("Preencha nome, CPF, telefone e data de nascimento");
        return;
      }
    }
    if (!email || !senha) {
      toast.error("Preencha e-mail e senha");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") {
        const isDefaultAdminCreds =
          email.trim().toLowerCase() === "contato@protenexus.com" && senha === "admin.1234";

        let { error } = await supabase.auth.signInWithPassword({ email, password: senha });

        // Primeiro acesso do admin padrão: cria/garante a conta e tenta de novo.
        if (error && isDefaultAdminCreds) {
          try {
            await bootstrapDefaultAdmin({ data: { email, password: senha } });
          } catch {
            // Sem service role (ex.: instalação local): cria via cadastro público.
            await supabase.auth
              .signUp({
                email: "contato@protenexus.com",
                password: "admin.1234",
                options: { emailRedirectTo: window.location.origin, data: { nome: "Administrador" } },
              })
              .catch(() => undefined);
          }
          const retry = await supabase.auth.signInWithPassword({ email, password: senha });
          error = retry.error;
        }

        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            try {
              const { exists } = await checkEmailExists({ data: { email } });
              toast.error(
                exists
                  ? "Senha incorreta. Tente novamente."
                  : "E-mail não encontrado. Verifique ou crie uma conta.",
              );
            } catch {
              toast.error("E-mail ou senha incorretos.");
            }
            return;
          }
          throw error;
        }

        // Garante o papel de admin (auto-reparo) antes de entrar.
        try {
          await ensureAdmin();
        } catch {
          /* ignore */
        }
        router.navigate({ to: "/", replace: true });

      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              nome: nome.trim(),
              cpf: cpf.replace(/\D/g, ""),
              telefone: telefone.replace(/\D/g, ""),
              data_nascimento: nascimento,
            },
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail para confirmar.");
        setMode("login");
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      let msg = "Erro ao autenticar.";
      if (/already registered|already exists|user already/i.test(raw)) {
        msg = "Este e-mail já está cadastrado. Faça login.";
      } else if (/invalid login credentials/i.test(raw)) {
        msg = "E-mail ou senha incorretos.";
      } else if (/password|6 characters|at least/i.test(raw)) {
        msg = "A senha deve ter pelo menos 6 caracteres.";
      } else if (raw) {
        msg = raw;
      }
      toast.error(msg);

    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com Google.");
      return;
    }
    if (result.redirected) return;
    router.navigate({ to: "/", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Card className="border-border/60 bg-card p-6 md:p-8">
          <img src={logo} alt="BilheteIA PRO" className="mx-auto mb-6 w-40 max-w-full" />
          <p className="text-center text-sm text-muted-foreground">
            {mode === "login"
              ? "Acesse sua conta para montar bilhetes."
              : "Cadastre-se para começar a usar."}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <>
                <div>
                  <Label htmlFor="nome" className="mb-2 block text-sm">Nome completo</Label>
                  <Input
                    id="nome"
                    type="text"
                    autoComplete="name"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="bg-input/40"
                  />
                </div>
                <div>
                  <Label htmlFor="cpf" className="mb-2 block text-sm">CPF</Label>
                  <Input
                    id="cpf"
                    type="text"
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(e) => setCpf(formatCpf(e.target.value))}
                    className="bg-input/40"
                  />
                </div>
                <div>
                  <Label htmlFor="nascimento" className="mb-2 block text-sm">Data de nascimento</Label>
                  <Input
                    id="nascimento"
                    type="date"
                    value={nascimento}
                    onChange={(e) => setNascimento(e.target.value)}
                    className="bg-input/40"
                  />
                </div>
              </>
            )}
            <div>
              <Label htmlFor="email" className="mb-2 block text-sm">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-input/40"
              />
            </div>
            <div>
              <Label htmlFor="senha" className="mb-2 block text-sm">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="bg-input/40"
              />
            </div>
            <Button type="submit" disabled={loading} size="lg" className="w-full font-semibold">
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Aguarde...</>
              ) : mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onGoogle}
          >
            Continuar com Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "login" ? "Não tem conta?" : "Já tem conta?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="font-medium text-primary hover:underline"
            >
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </p>
        </Card>
      </div>
    </main>
  );
}
