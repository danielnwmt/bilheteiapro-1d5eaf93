import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Loader2, Megaphone, ShieldAlert, CheckCircle2 } from "lucide-react";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/reclamacoes")({
  head: () => ({ meta: [{ title: "Ouvidoria — Admin BilheteIA" }] }),
  component: ReclamacoesPage,
});

type Reclamacao = {
  id: string;
  user_id: string;
  conteudo: string;
  status: string;
  created_at: string;
  nome?: string;
  email?: string;
};

function ReclamacoesPage() {
  const router = useRouter();
  const { data: access } = useAccess();
  const [currentEmail, setCurrentEmail] = useState("");
  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const [itens, setItens] = useState<Reclamacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
    });
  }, []);

  async function carregar() {
    setCarregando(true);
    const { data } = await supabase
      .from("reclamacoes")
      .select("id, user_id, conteudo, status, created_at")
      .order("created_at", { ascending: false });
    const rows = (data as Reclamacao[]) ?? [];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    if (ids.length) {
      const { data: perfis } = await supabase
        .from("profiles")
        .select("id, nome, email")
        .in("id", ids);
      const map = new Map((perfis ?? []).map((p: any) => [p.id, p]));
      rows.forEach((r) => {
        const p = map.get(r.user_id);
        r.nome = p?.nome;
        r.email = p?.email;
      });
    }
    setItens(rows);
    setCarregando(false);
  }

  useEffect(() => {
    if (!isAdmin) return;
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function resolver(r: Reclamacao) {
    const novo = r.status === "resolvida" ? "aberta" : "resolvida";
    const { error } = await supabase.from("reclamacoes").update({ status: novo }).eq("id", r.id);
    if (error) {
      toast.error("Erro ao atualizar");
      return;
    }
    setItens((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: novo } : x)));
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Ouvidoria</h1>
        </div>

        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem acessar a ouvidoria.
          </Card>
        ) : carregando ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : itens.length === 0 ? (
          <Card className="border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhuma reclamação registrada.
          </Card>
        ) : (
          <div className="space-y-3">
            {itens.map((r) => (
              <Card key={r.id} className="border-border/60 bg-card p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{r.nome || r.email || "Cliente"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <Button
                    variant={r.status === "resolvida" ? "outline" : "default"}
                    size="sm"
                    onClick={() => resolver(r)}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {r.status === "resolvida" ? "Resolvida" : "Marcar resolvida"}
                  </Button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{r.conteudo}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
