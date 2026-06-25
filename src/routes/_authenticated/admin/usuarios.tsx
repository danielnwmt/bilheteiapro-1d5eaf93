import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listClientes, setClientePlano, updateClienteProfile } from "@/lib/access.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, KeyRound, Settings, Pencil } from "lucide-react";
import { PLANOS, type Plano } from "@/lib/planos";
import { usePlanos } from "@/hooks/usePlanos";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Clientes — Admin BilheteIA" }] }),
  component: UsuariosPage,
});

function UsuariosPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { byPlano } = usePlanos();
  const fetchClientes = useServerFn(listClientes);
  const salvar = useServerFn(setClientePlano);
  const salvarPerfil = useServerFn(updateClienteProfile);
  const [edit, setEdit] = useState<Record<string, { plano: Plano; status: "ativo" | "inativo" }>>({});
  const [perfil, setPerfil] = useState<
    Record<string, { nome: string; email: string; cpf: string; data_nascimento: string }>
  >({});
  const [openId, setOpenId] = useState<string | null>(null);

  const formatCpf = (v: string) =>
    v
      .replace(/\D/g, "")
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: () => fetchClientes(),
  });

  const mut = useMutation({
    mutationFn: (v: { clienteId: string; plano: Plano; status: "ativo" | "inativo" }) =>
      salvar({ data: v }),
    onSuccess: () => {
      toast.success("Cliente atualizado");
      setOpenId(null);
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const mutPerfil = useMutation({
    mutationFn: (v: {
      clienteId: string;
      nome: string;
      email: string;
      cpf: string;
      data_nascimento: string | null;
    }) => salvarPerfil({ data: v }),
    onSuccess: () => {
      toast.success("Cadastro atualizado");
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar cadastro"),
  });

  const handleSalvar = (c: any, cur: { plano: Plano; status: "ativo" | "inativo" }) => {
    const p = perfil[c.id] ?? {
      nome: c.nome ?? "",
      email: c.email ?? "",
      cpf: c.cpf ?? "",
      data_nascimento: c.data_nascimento ?? "",
    };
    mutPerfil.mutate({
      clienteId: c.id,
      nome: p.nome,
      email: p.email,
      cpf: p.cpf,
      data_nascimento: p.data_nascimento || null,
    });
    mut.mutate({ clienteId: c.id, plano: cur.plano, status: cur.status });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/configuracoes" })}>
              <Settings className="mr-2 h-4 w-4" /> Planos
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin/apis" })}>
              <KeyRound className="mr-2 h-4 w-4" /> APIs do sistema
            </Button>
          </div>
        </div>

        <h1 className="mb-6 text-2xl font-bold">Clientes</h1>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {(clientes ?? []).map((c) => {
              const cur = edit[c.id] ?? {
                plano: (c.plano as Plano) ?? "start",
                status: (c.status as "ativo" | "inativo") ?? "inativo",
              };
              const pf = perfil[c.id] ?? {
                nome: c.nome ?? "",
                email: c.email ?? "",
                cpf: c.cpf ?? "",
                data_nascimento: c.data_nascimento ?? "",
              };
              const isOpen = openId === c.id;
              return (
                <Card key={c.id} className="border-border/60 bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.nome || c.email || c.id}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.email}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.roles.map((r) => (
                          <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isOpen ? (
                        <>
                          <select
                            value={cur.plano}
                            onChange={(e) =>
                              setEdit((s) => ({ ...s, [c.id]: { ...cur, plano: e.target.value as Plano } }))
                            }
                            className="rounded-md border border-border bg-input/40 px-2 py-1 text-sm"
                          >
                            {PLANOS.map((p) => (
                              <option key={p} value={p}>{byPlano[p]?.nome ?? p}</option>
                            ))}
                          </select>
                          <select
                            value={cur.status}
                            onChange={(e) =>
                              setEdit((s) => ({
                                ...s,
                                [c.id]: { ...cur, status: e.target.value as "ativo" | "inativo" },
                              }))
                            }
                            className="rounded-md border border-border bg-input/40 px-2 py-1 text-sm"
                          >
                            <option value="ativo">ativo</option>
                            <option value="inativo">inativo</option>
                          </select>
                        </>
                      ) : (
                        <>
                          <div className="text-right text-sm">
                            <p className="font-medium">{byPlano[(c.plano as Plano)]?.nome ?? "Sem plano"}</p>
                            <p className="text-xs text-muted-foreground">{c.status}</p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => setOpenId(c.id)}>
                            <Pencil className="mr-2 h-4 w-4" /> Editar
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 border-t border-border/60 pt-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Nome completo</Label>
                          <Input
                            value={pf.nome}
                            onChange={(e) =>
                              setPerfil((s) => ({ ...s, [c.id]: { ...pf, nome: e.target.value } }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">E-mail</Label>
                          <Input
                            type="email"
                            value={pf.email}
                            onChange={(e) =>
                              setPerfil((s) => ({ ...s, [c.id]: { ...pf, email: e.target.value } }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">CPF</Label>
                          <Input
                            value={formatCpf(pf.cpf)}
                            onChange={(e) =>
                              setPerfil((s) => ({ ...s, [c.id]: { ...pf, cpf: e.target.value } }))
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Data de nascimento</Label>
                          <Input
                            type="date"
                            value={pf.data_nascimento ?? ""}
                            onChange={(e) =>
                              setPerfil((s) => ({ ...s, [c.id]: { ...pf, data_nascimento: e.target.value } }))
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Button
                          size="sm"
                          disabled={mut.isPending || mutPerfil.isPending}
                          onClick={() => handleSalvar(c, cur)}
                        >
                          Salvar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            {(clientes ?? []).length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente ainda.</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
