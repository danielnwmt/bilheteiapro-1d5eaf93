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
  recursosVazios,
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
  const criar = useServerFn(createPlanoConfig);
  const remover = useServerFn(deletePlanoConfig);
  const [currentEmail, setCurrentEmail] = useState("");

  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const [draft, setDraft] = useState<Record<Plano, PlanoConfig>>({} as Record<Plano, PlanoConfig>);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentEmail(String(data.user?.email ?? "").trim().toLowerCase());
    });
  }, []);

  // Assinatura estável das chaves de plano para evitar re-execução em loop
  // (o array `list` é recriado a cada render).
  const listKey = list.map((c) => c.plano).join(",");

  useEffect(() => {
    if (!list.length) return;
    setDraft((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const c of list) {
        if (!next[c.plano]) {
          next[c.plano] = structuredClone(c);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);


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
          descontoSemestral: cfg.descontoSemestral ?? 0,
          descontoAnual: cfg.descontoAnual ?? 0,
        },
      }),
    onSuccess: () => {
      toast.success("Plano atualizado");
      qc.invalidateQueries({ queryKey: ["plano_config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const [novoOpen, setNovoOpen] = useState(false);
  const emptyNovo = () => ({
    plano: "",
    nome: "",
    preco: "",
    descricao: "",
    historicoDias: 15,
    ligas: [] as string[],
    recursos: recursosVazios() as Record<string, boolean>,
    descontoSemestral: 0,
    descontoAnual: 0,
  });
  const [novo, setNovo] = useState(emptyNovo);

  const criarMut = useMutation({
    mutationFn: () =>
      criar({
        data: {
          plano: novo.plano.trim().toLowerCase(),
          nome: novo.nome.trim(),
          preco: novo.preco.trim(),
          descricao: novo.descricao.trim(),
          historicoDias: Number(novo.historicoDias) || 15,
          ligas: novo.ligas,
          recursos: novo.recursos,
          descontoSemestral: Number(novo.descontoSemestral) || 0,
          descontoAnual: Number(novo.descontoAnual) || 0,
        },
      }),
    onSuccess: () => {
      toast.success("Plano criado");
      setNovoOpen(false);
      setNovo(emptyNovo());
      qc.invalidateQueries({ queryKey: ["plano_config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao criar plano"),
  });

  function toggleNovoLiga(liga: string) {
    setNovo((s) => ({
      ...s,
      ligas: s.ligas.includes(liga) ? s.ligas.filter((l) => l !== liga) : [...s.ligas, liga],
    }));
  }

  function toggleNovoRecurso(key: string) {
    setNovo((s) => ({ ...s, recursos: { ...s.recursos, [key]: !s.recursos[key] } }));
  }


  const removerMut = useMutation({
    mutationFn: (plano: Plano) => remover({ data: { plano } }),
    onSuccess: () => {
      toast.success("Plano removido");
      qc.invalidateQueries({ queryKey: ["plano_config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao remover"),
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

        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="mb-2 text-2xl font-bold">Configurações dos planos</h1>
            <p className="text-sm text-muted-foreground">
              Edite preço, descrição, ligas e recursos de cada plano. O preço aqui é o exibido na
              página de planos.
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setNovoOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Adicionar plano
            </Button>
          )}
        </div>

        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem editar as configurações de planos.
          </Card>
        ) : isLoading ? (
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
                    <div className="flex items-center gap-2">
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={removerMut.isPending}
                        onClick={() => {
                          if (confirm(`Remover o plano "${base.plano}"?`)) removerMut.mutate(base.plano);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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

      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo plano</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1 block text-sm">Identificador (sem espaços)</Label>
                <Input
                  placeholder="ex: premium"
                  value={novo.plano}
                  onChange={(e) => setNovo((s) => ({ ...s, plano: e.target.value }))}
                  className="bg-input/40"
                />
              </div>
              <div>
                <Label className="mb-1 block text-sm">Nome</Label>
                <Input
                  placeholder="ex: Premium"
                  value={novo.nome}
                  onChange={(e) => setNovo((s) => ({ ...s, nome: e.target.value }))}
                  className="bg-input/40"
                />
              </div>
              <div>
                <Label className="mb-1 block text-sm">Preço</Label>
                <Input
                  placeholder="ex: R$ 99,90"
                  value={novo.preco}
                  onChange={(e) => setNovo((s) => ({ ...s, preco: e.target.value }))}
                  className="bg-input/40"
                />
              </div>
              <div>
                <Label className="mb-1 block text-sm">Dias de histórico</Label>
                <Input
                  type="number"
                  min={1}
                  value={novo.historicoDias}
                  onChange={(e) =>
                    setNovo((s) => ({ ...s, historicoDias: Number(e.target.value) || 0 }))
                  }
                  className="bg-input/40"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-sm">Descrição</Label>
                <Input
                  placeholder="ex: Para quem busca múltiplas inteligentes com IA."
                  value={novo.descricao}
                  onChange={(e) => setNovo((s) => ({ ...s, descricao: e.target.value }))}
                  className="bg-input/40"
                />
              </div>
            </div>

            <div>
              <Label className="mb-2 block text-sm font-semibold">Ligas liberadas</Label>
              <div className="flex flex-wrap gap-2">
                {TODAS_LIGAS.map((liga) => {
                  const on = novo.ligas.includes(liga);
                  return (
                    <button
                      type="button"
                      key={liga}
                      onClick={() => toggleNovoLiga(liga)}
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

            <div>
              <Label className="mb-2 block text-sm font-semibold">Recursos liberados</Label>
              <div className="flex flex-wrap gap-2">
                {RECURSO_LABELS.map((r) => {
                  const on = !!novo.recursos[r.key];
                  return (
                    <button
                      type="button"
                      key={r.key}
                      onClick={() => toggleNovoRecurso(r.key)}
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
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={criarMut.isPending || !novo.plano.trim() || !novo.nome.trim() || !novo.preco.trim()}
              onClick={() => criarMut.mutate()}
            >
              {criarMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar plano
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </main>
  );
}
