import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, User, Mail, Lock } from "lucide-react";
import { toast } from "sonner";
import { getMyProfile, updateMyName } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/perfil")({
  component: PerfilPage,
});

function PerfilPage() {
  const router = useRouter();
  const fetchProfile = useServerFn(getMyProfile);
  const saveName = useServerFn(updateMyName);

  const { data, refetch } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
    staleTime: 30_000,
  });

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [savingNome, setSavingNome] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSenha, setSavingSenha] = useState(false);

  useEffect(() => {
    if (data) {
      setNome(data.nome ?? "");
      setEmail(data.email ?? "");
    }
  }, [data]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: userData }) => {
      const user = userData.user;
      if (!user) return;
      const meta = user.user_metadata ?? {};
      setNome((current) => current || meta.nome || meta.full_name || "");
      setEmail((current) => current || user.email || "");

      supabase
        .from("profiles")
        .select("nome, email")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data: profile }) => {
          if (!profile) return;
          setNome((current) => current || profile.nome || "");
          setEmail((current) => current || profile.email || "");
        });
    });
  }, []);

  async function salvarNome() {
    setSavingNome(true);
    try {
      await saveName({ data: { nome } });
      toast.success("Nome atualizado.");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar");
    } finally {
      setSavingNome(false);
    }
  }

  async function salvarEmail() {
    if (!email.trim()) return toast.error("Informe um e-mail válido");
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() });
      if (error) throw error;
      toast.success("E-mail atualizado. Confira sua caixa de entrada para confirmar.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível alterar o e-mail");
    } finally {
      setSavingEmail(false);
    }
  }

  async function salvarSenha() {
    if (senha.length < 6) return toast.error("A senha deve ter ao menos 6 caracteres");
    if (senha !== senha2) return toast.error("As senhas não conferem");
    setSavingSenha(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setSenha("");
      setSenha2("");
      toast.success("Senha alterada com sucesso.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível alterar a senha");
    } finally {
      setSavingSenha(false);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-4 py-10 md:py-16">
        <Button
          variant="ghost"
          size="sm"
          className="mb-6"
          onClick={() => router.navigate({ to: "/" })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>

        <h1 className="mb-1 text-2xl font-bold">Meu perfil</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Veja seus dados e atualize seu e-mail e senha.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="mb-4 flex items-center gap-2 font-semibold">
                <User className="h-4 w-4 text-primary" /> Nome
              </div>
              <div className="space-y-2">
                <Label htmlFor="nome">Nome completo</Label>
                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <Button className="mt-4" onClick={salvarNome} disabled={savingNome}>
                {savingNome && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar nome
              </Button>
            </Card>

            <Card className="p-6">
              <div className="mb-4 flex items-center gap-2 font-semibold">
                <Mail className="h-4 w-4 text-primary" /> E-mail
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button className="mt-4" onClick={salvarEmail} disabled={savingEmail}>
                {savingEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Alterar e-mail
              </Button>
            </Card>

            <Card className="p-6">
              <div className="mb-4 flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-primary" /> Senha
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="senha">Nova senha</Label>
                  <Input
                    id="senha"
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="senha2">Confirmar nova senha</Label>
                  <Input
                    id="senha2"
                    type="password"
                    value={senha2}
                    onChange={(e) => setSenha2(e.target.value)}
                  />
                </div>
              </div>
              <Button className="mt-4" onClick={salvarSenha} disabled={savingSenha}>
                {savingSenha && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Alterar senha
              </Button>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
