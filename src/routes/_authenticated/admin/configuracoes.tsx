import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import {
  TODAS_LIGAS,
  RECURSO_LABELS,
  type Plano,
  type PlanoConfig,
} from "@/lib/planos";
import { usePlanos } from "@/hooks/usePlanos";
import {
  createPlanoConfig,
  deletePlanoConfig,
  updatePlanoConfig,
} from "@/lib/planoConfig.functions";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações de planos — Admin BilheteIA" }] }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: access } = useAccess();
  const { list, isLoading } = usePlanos();
  const salvar = useServerFn(updatePlanoConfig);
  const [currentEmail, setCurrentEmail] = useState("");

  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const [draft, setDraft] = useState<Record<Plano, PlanoConfig>>({} as Record<Plano, PlanoConfig>);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(String(data.user?.email ?? "").trim().toLowerCase());
    });

    if (list.length) {
      setDraft((prev) => {
        const next = { ...prev };
        for (const c of list) if (!next[c.plano]) next[c.plano] = structuredClone(c);
        return next;
      });
    }
  }, [list]);

  const mut = useMutation({
    mutationFn: (cfg: PlanoConfig) =>
      salvar({
        data: {
          plano: cfg.plano,
          nome: cfg.nome,
          preco: cfg.preco,
          descricao: cfg.descricao,
          historicoDias: cfg.historicoDias,
          ligas: cfg.ligas,
          recursos: cfg.recursos,
        },
      }),
    onSuccess: () => {
      toast.success("Plano atualizado");
      qc.invalidateQueries({ queryKey: ["plano_config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  function update(plano: Plano, patch: Partial<PlanoConfig>) {
    setDraft((s) => ({ ...s, [plano]: { ...s[plano], ...patch } }));
  }

  function toggleLiga(plano: Plano, liga: string) {
    setDraft((s) => {
      const cfg = s[plano];
      const ligas = cfg.ligas.includes(liga)
        ? cfg.ligas.filter((l) => l !== liga)
        : [...cfg.ligas, liga];
      return { ...s, [plano]: { ...cfg, ligas } };
    });
  }

  function toggleRecurso(plano: Plano, key: string) {
    setDraft((s) => {
      const cfg = s[plano];
      return { ...s, [plano]: { ...cfg, recursos: { ...cfg.recursos, [key]: !cfg.recursos[key as keyof typeof cfg.recursos] } } };
    });
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <h1 className="mb-2 text-2xl font-bold">Configurações dos planos</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Edite preço, descrição, ligas e recursos de cada plano. O preço aqui é o exibido na
          página de planos.
        </p>

        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem editar as configurações de planos.
          </Card>
        ) : isLoading || !list.length ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {list.map((base) => {
              const cfg = draft[base.plano] ?? base;
              return (
                <Card key={base.plano} className="border-border/60 bg-card p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold capitalize">{base.plano}</h2>
                    <Button
                      size="sm"
                      disabled={mut.isPending}
                      onClick={() => mut.mutate(cfg)}
                    >
                      {mut.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar
                    </Button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label className="mb-1 block text-sm">Nome</Label>
                      <Input
                        value={cfg.nome}
                        onChange={(e) => update(base.plano, { nome: e.target.value })}
                        className="bg-input/40"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block text-sm">Preço</Label>
                      <Input
                        value={cfg.preco}
                        onChange={(e) => update(base.plano, { preco: e.target.value })}
                        className="bg-input/40"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="mb-1 block text-sm">Descrição</Label>
                      <Input
                        value={cfg.descricao}
                        onChange={(e) => update(base.plano, { descricao: e.target.value })}
                        className="bg-input/40"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 block text-sm">Dias de histórico</Label>
                      <Input
                        type="number"
                        min={1}
                        value={cfg.historicoDias}
                        onChange={(e) =>
                          update(base.plano, { historicoDias: Number(e.target.value) || 0 })
                        }
                        className="bg-input/40"
                      />
                    </div>
                  </div>

                  <div className="mt-5">
                    <Label className="mb-2 block text-sm font-semibold">Ligas liberadas</Label>
                    <div className="flex flex-wrap gap-2">
                      {TODAS_LIGAS.map((liga) => {
                        const on = cfg.ligas.includes(liga);
                        return (
                          <button
                            type="button"
                            key={liga}
                            onClick={() => toggleLiga(base.plano, liga)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              on
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {liga}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-5">
                    <Label className="mb-2 block text-sm font-semibold">Recursos liberados</Label>
                    <div className="flex flex-wrap gap-2">
                      {RECURSO_LABELS.map((r) => {
                        const on = !!cfg.recursos[r.key];
                        return (
                          <button
                            type="button"
                            key={r.key}
                            onClick={() => toggleRecurso(base.plano, r.key)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              on
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-border bg-input/40 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
