import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ADMIN_EMAIL, listClientes, setClientePlano, updateClienteProfile, setClientePassword, createCliente } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, KeyRound, Settings, Pencil, UserPlus, ShieldPlus } from "lucide-react";
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
  const salvarSenha = useServerFn(setClientePassword);
  const criarCliente = useServerFn(createCliente);
  const [edit, setEdit] = useState<Record<string, { plano: Plano; status: "ativo" | "inativo" }>>({});
  const [perfil, setPerfil] = useState<
    Record<string, { nome: string; email: string; cpf: string; telefone: string; data_nascimento: string }>
  >({});
  const [senhas, setSenhas] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNovo, setShowNovo] = useState(false);
  const [novoTipo, setNovoTipo] = useState<"cliente" | "admin">("cliente");
  const [sessionUser, setSessionUser] = useState<{ id: string; email: string } | null>(null);
  const [novo, setNovo] = useState({
    nome: "",
    email: "",
    senha: "",
    cpf: "",
    telefone: "",
    data_nascimento: "",
    plano: "start" as Plano,
    status: "ativo" as "ativo" | "inativo",
  });

  const traduzErro = (e: any, fallback: string) => {
    const m = String(e?.message ?? "").toLowerCase();
    if (m.includes("weak") || m.includes("easy to guess") || m.includes("pwned") || m.includes("leaked")) {
      return "Senha muito fraca ou já vazada. Escolha uma senha mais forte (evite sequências como admin1234).";
    }
    if (m.includes("should be at least") || m.includes("at least 6")) {
      return "A senha deve ter pelo menos 6 caracteres.";
    }
    return e?.message ?? fallback;
  };

  const formatCpf = (v: string) =>
    v
      .replace(/\D/g, "")
      .slice(0, 11)
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

  const formatTelefone = (v: string) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 10) {
      return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
    }
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
  };

  const { data: clientes, isLoading } = useQuery({
    queryKey: ["clientes"],
    queryFn: () => fetchClientes(),
    placeholderData: [],
    staleTime: 60_000,
  });

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user;
      setSessionUser(
        user
          ? { id: user.id, email: String(user.email ?? "").trim().toLowerCase() }
          : null,
      );
    });
    return () => {
      active = false;
    };
  }, []);

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
      telefone: string;
      data_nascimento: string | null;
    }) => salvarPerfil({ data: v }),
    onSuccess: () => {
      toast.success("Cadastro atualizado");
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar cadastro"),
  });

  const mutSenha = useMutation({
    mutationFn: (v: { clienteId: string; senha: string }) => salvarSenha({ data: v }),
    onSuccess: (_d, v) => {
      toast.success("Senha alterada");
      setSenhas((s) => ({ ...s, [v.clienteId]: "" }));
    },
    onError: (e: any) => toast.error(traduzErro(e, "Erro ao alterar senha")),
  });

  const mutNovo = useMutation({
    mutationFn: (v: typeof novo & { isAdmin: boolean }) =>
      criarCliente({
        data: {
          nome: v.nome,
          email: v.email,
          senha: v.senha,
          cpf: v.cpf,
          telefone: v.telefone,
          data_nascimento: v.data_nascimento || null,
          plano: v.plano,
          status: v.status,
          isAdmin: v.isAdmin,
        },
      }),
    onSuccess: (_d, v) => {
      toast.success(v.isAdmin ? "Admin criado" : "Cliente criado");
      setShowNovo(false);
      setNovo({ nome: "", email: "", senha: "", cpf: "", telefone: "", data_nascimento: "", plano: "start", status: "ativo" });
      qc.invalidateQueries({ queryKey: ["clientes"] });
    },
    onError: (e: any) => toast.error(traduzErro(e, "Erro ao criar usuário")),
  });

  const handleSalvar = (c: any, cur: { plano: Plano; status: "ativo" | "inativo" }) => {
    const p = perfil[c.id] ?? {
      nome: c.nome ?? "",
      email: c.email ?? "",
      cpf: c.cpf ?? "",
      telefone: c.telefone ?? "",
      data_nascimento: c.data_nascimento ?? "",
    };
    mutPerfil.mutate({
      clienteId: c.id,
      nome: p.nome,
      email: p.email,
      cpf: p.cpf,
      telefone: p.telefone,
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

        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Usuários</h1>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                setNovoTipo("cliente");
                setShowNovo(true);
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" /> Adicionar cliente
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNovoTipo("admin");
                setShowNovo(true);
              }}
            >
              <ShieldPlus className="mr-2 h-4 w-4" /> Criar admin
            </Button>
          </div>
        </div>

        {showNovo && (
          <Card className="mb-6 border-border/60 bg-card p-4">
            <p className="mb-3 font-semibold">{novoTipo === "admin" ? "Novo admin" : "Novo cliente"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Nome completo</Label>
                <Input value={novo.nome} onChange={(e) => setNovo((s) => ({ ...s, nome: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">E-mail</Label>
                <Input type="email" value={novo.email} onChange={(e) => setNovo((s) => ({ ...s, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Senha</Label>
                <Input type="text" placeholder="Mínimo 6 caracteres" value={novo.senha} onChange={(e) => setNovo((s) => ({ ...s, senha: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CPF</Label>
                <Input value={formatCpf(novo.cpf)} onChange={(e) => setNovo((s) => ({ ...s, cpf: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Telefone</Label>
                <Input value={formatTelefone(novo.telefone)} onChange={(e) => setNovo((s) => ({ ...s, telefone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data de nascimento</Label>
                <Input type="date" value={novo.data_nascimento} onChange={(e) => setNovo((s) => ({ ...s, data_nascimento: e.target.value }))} />
              </div>
              {novoTipo === "cliente" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Plano</Label>
                    <select
                      value={novo.plano}
                      onChange={(e) => setNovo((s) => ({ ...s, plano: e.target.value as Plano }))}
                      className="w-full rounded-md border border-border bg-input/40 px-2 py-2 text-sm"
                    >
                      {PLANOS.map((p) => (
                        <option key={p} value={p}>{byPlano[p]?.nome ?? p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <select
                      value={novo.status}
                      onChange={(e) => setNovo((s) => ({ ...s, status: e.target.value as "ativo" | "inativo" }))}
                      className="w-full rounded-md border border-border bg-input/40 px-2 py-2 text-sm"
                    >
                      <option value="ativo">ativo</option>
                      <option value="inativo">inativo</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                disabled={mutNovo.isPending || !novo.email.trim() || novo.senha.length < 6}
                onClick={() => mutNovo.mutate({ ...novo, isAdmin: novoTipo === "admin" })}
              >
                {mutNovo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {novoTipo === "admin" ? "Criar admin" : "Criar cliente"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowNovo(false)}>Cancelar</Button>
            </div>
          </Card>
        )}




        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-8">
            {(() => {
              const renderCard = (c: any) => {
              const cur = edit[c.id] ?? {
                plano: (c.plano as Plano) ?? "start",
                status: (c.status as "ativo" | "inativo") ?? "inativo",
              };
              const pf = perfil[c.id] ?? {
                nome: c.nome ?? "",
                email: c.email ?? "",
                cpf: c.cpf ?? "",
                telefone: c.telefone ?? "",
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
                        {c.roles.map((r: string) => (
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
                        <div className="space-y-1">
                          <Label className="text-xs">Telefone</Label>
                          <Input
                            value={formatTelefone(pf.telefone ?? "")}
                            onChange={(e) =>
                              setPerfil((s) => ({ ...s, [c.id]: { ...pf, telefone: e.target.value } }))
                            }
                          />
                        </div>
                      </div>

                      <div className="mt-4 border-t border-border/60 pt-4">
                        <Label className="text-xs">Nova senha</Label>
                        <div className="mt-1 flex flex-wrap items-end gap-2">
                          <Input
                            type="text"
                            placeholder="Mínimo 6 caracteres"
                            value={senhas[c.id] ?? ""}
                            onChange={(e) =>
                              setSenhas((s) => ({ ...s, [c.id]: e.target.value }))
                            }
                            className="max-w-xs"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={mutSenha.isPending || (senhas[c.id] ?? "").length < 6}
                            onClick={() => mutSenha.mutate({ clienteId: c.id, senha: senhas[c.id] ?? "" })}
                          >
                            <KeyRound className="mr-2 h-4 w-4" /> Alterar senha
                          </Button>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Define uma nova senha para o cliente (somente admin).
                        </p>
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
              };

              const raw = Array.isArray(clientes) ? clientes : [];
              const hasAdmin = raw.some(
                (c: any) =>
                  String(c.email ?? "").trim().toLowerCase() === ADMIN_EMAIL ||
                  c.roles?.includes("admin") ||
                  c.roles?.includes("operador"),
              );
              const fallbackAdmin =
                sessionUser?.email === ADMIN_EMAIL && !hasAdmin
                  ? [
                      {
                        id: sessionUser.id,
                        nome: "Administrador",
                        email: ADMIN_EMAIL,
                        cpf: null,
                        data_nascimento: null,
                        created_at: new Date().toISOString(),
                        roles: ["admin"],
                        plano: "elite",
                        status: "ativo",
                      },
                    ]
                  : [];
              const all = [...fallbackAdmin, ...raw];
              const admins = all.filter((c) => c.roles.includes("admin") || c.roles.includes("operador"));
              const clis = all.filter((c) => !c.roles.includes("admin") && !c.roles.includes("operador"));

              return (
                <>
                  <section>
                    <h2 className="mb-3 text-lg font-semibold">Administradores</h2>
                    <div className="space-y-3">
                      {admins.map(renderCard)}
                      {admins.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum admin ainda.</p>
                      )}
                    </div>
                  </section>
                  <section>
                    <h2 className="mb-3 text-lg font-semibold">Clientes</h2>
                    <div className="space-y-3">
                      {clis.map(renderCard)}
                      {clis.length === 0 && (
                        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum cliente ainda.</p>
                      )}
                    </div>
                  </section>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </main>
  );
}
