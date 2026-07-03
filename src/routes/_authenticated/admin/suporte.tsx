import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Save, ShieldAlert, LifeBuoy, Send, MessageSquare, Search, MessageCircle, CheckCircle2, Clock, Timer, GitBranch, Trash2, Plus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { getSuporte, setSystemConfig } from "@/lib/access.functions";
import {
  listSuporteConversas,
  getSuporteMetricas,
  type SuporteConversa,
  type SuporteMetricas,
} from "@/lib/suporte.functions";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/suporte")({
  head: () => ({ meta: [{ title: "Suporte — Admin BilheteIA" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    config: search.config === true || search.config === "true" || search.config === 1,
  }),
  component: SuportePage,
});

type Mensagem = {
  id: string;
  autor: "cliente" | "suporte";
  conteudo: string;
  created_at: string;
};

function SuportePage() {
  const router = useRouter();
  const { config: modoConfig } = Route.useSearch();
  const { data: access } = useAccess();
  const [currentEmail, setCurrentEmail] = useState("");
  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const carregarSuporte = useServerFn(getSuporte);
  const salvarConfig = useServerFn(setSystemConfig);
  const carregarConversas = useServerFn(listSuporteConversas);
  const carregarMetricas = useServerFn(getSuporteMetricas);

  const [suporte, setSuporte] = useState({ whatsapp: "", email: "", mensagem: "", modo: "whatsapp" });
  const [conversas, setConversas] = useState<SuporteConversa[]>([]);
  const [selecionado, setSelecionado] = useState<SuporteConversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<"abertos" | "encerrados">("abertos");
  const [metricas, setMetricas] = useState<SuporteMetricas | null>(null);
  const [fluxo, setFluxo] = useState<{ saudacao: string; opcoes: { label: string; resposta: string }[] }>({
    saudacao: "",
    opcoes: [],
  });
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
    });
  }, []);

  useEffect(() => {
    carregarSuporte()
      .then((s) => {
        setSuporte({
          whatsapp: s.whatsapp ?? "",
          email: s.email ?? "",
          mensagem: s.mensagem ?? "",
          modo: s.modo ?? "whatsapp",
        });
        setFluxo({
          saudacao: s.fluxo?.saudacao ?? "",
          opcoes: s.fluxo?.opcoes ?? [],
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recarregarConversas() {
    carregarConversas()
      .then((c) => setConversas(c))
      .catch(() => {});
    carregarMetricas()
      .then((m) => setMetricas(m))
      .catch(() => {});
  }

  useEffect(() => {
    if (!isAdmin) return;
    recarregarConversas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function encerrarChamado() {
    if (!selecionado) return;
    const { error } = await supabase
      .from("suporte_status")
      .upsert(
        { user_id: selecionado.userId, encerrada: true, encerrada_em: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) {
      toast.error("Erro ao encerrar");
      return;
    }
    toast.success("Chamado encerrado");
    setSelecionado(null);
    setAba("encerrados");
    recarregarConversas();
  }

  async function reabrirChamado() {
    if (!selecionado) return;
    const { error } = await supabase
      .from("suporte_status")
      .upsert(
        { user_id: selecionado.userId, encerrada: false, encerrada_em: null },
        { onConflict: "user_id" },
      );
    if (error) {
      toast.error("Erro ao reabrir");
      return;
    }
    toast.success("Chamado reaberto");
    setSelecionado(null);
    setAba("abertos");
    recarregarConversas();
  }


  // Mensagens da conversa selecionada + realtime.
  useEffect(() => {
    if (!selecionado) return;
    const uid = selecionado.userId;
    supabase
      .from("suporte_mensagens")
      .select("id, autor, conteudo, created_at")
      .eq("user_id", uid)
      .order("created_at", { ascending: true })
      .then(({ data }) => setMsgs((data as Mensagem[]) ?? []));

    // marca as mensagens do cliente como lidas
    supabase
      .from("suporte_mensagens")
      .update({ lida: true })
      .eq("user_id", uid)
      .eq("autor", "cliente")
      .eq("lida", false)
      .then(() => {});

    const canal = supabase
      .channel(`admin-suporte-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "suporte_mensagens", filter: `user_id=eq.${uid}` },
        (payload) => {
          const nova = payload.new as Mensagem;
          setMsgs((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [selecionado]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const suporteMut = useMutation({
    mutationFn: async () => {
      await salvarConfig({ data: { chave: "SUPORTE_MODO", valor: suporte.modo, descricao: "Modo de suporte" } });
      await salvarConfig({ data: { chave: "SUPORTE_WHATSAPP", valor: suporte.whatsapp.trim(), descricao: "WhatsApp de suporte" } });
      await salvarConfig({ data: { chave: "SUPORTE_EMAIL", valor: suporte.email.trim(), descricao: "E-mail de suporte" } });
      await salvarConfig({ data: { chave: "SUPORTE_MENSAGEM", valor: suporte.mensagem.trim(), descricao: "Mensagem padrão de suporte" } });
      const fluxoLimpo = {
        saudacao: fluxo.saudacao.trim(),
        opcoes: fluxo.opcoes
          .map((o) => ({ label: o.label.trim(), resposta: o.resposta.trim() }))
          .filter((o) => o.label),
      };
      await salvarConfig({ data: { chave: "SUPORTE_FLUXO", valor: JSON.stringify(fluxoLimpo), descricao: "Fluxo automático de atendimento" } });
    },
    onSuccess: () => toast.success("Configuração salva"),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  async function responder() {
    const conteudo = resposta.trim();
    if (!conteudo || !selecionado || enviando) return;
    setEnviando(true);
    const { error } = await supabase
      .from("suporte_mensagens")
      .insert({ user_id: selecionado.userId, autor: "suporte", conteudo });
    setEnviando(false);
    if (error) {
      toast.error("Erro ao enviar");
      return;
    }
    setResposta("");
  }

  const mostraChat = !modoConfig && (suporte.modo === "chat" || suporte.modo === "ambos");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          {modoConfig ? (
            <LifeBuoy className="h-6 w-6 text-primary" />
          ) : (
            <MessageCircle className="h-6 w-6 text-primary" />
          )}
          <h1 className="text-2xl font-bold">{modoConfig ? "Suporte" : "Chat"}</h1>
        </div>


        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem acessar o suporte.
          </Card>
        ) : (
          <div className="space-y-6">
            {modoConfig && (
            <Card className="border-border/60 bg-card p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold">Configuração</h2>
                <Button size="sm" disabled={suporteMut.isPending} onClick={() => suporteMut.mutate()}>
                  {suporteMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Salvar
                </Button>
              </div>

              <div className="mb-4">
                <Label className="mb-1 block text-sm">Canal de atendimento</Label>
                <Select value={suporte.modo} onValueChange={(v) => setSuporte((s) => ({ ...s, modo: v }))}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chat">Chat do sistema</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="ambos">Chat + WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
                <div className="md:col-span-2">
                  <Label className="mb-1 block text-sm">Mensagem padrão (opcional)</Label>
                  <Input
                    value={suporte.mensagem}
                    onChange={(e) => setSuporte((s) => ({ ...s, mensagem: e.target.value }))}
                    placeholder="Olá! Como podemos ajudar?"
                  />
                </div>
              </div>

              <div className="mt-6 border-t border-border/60 pt-5">
                <div className="mb-1 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Fluxo automático (menu do cliente)</h3>
                </div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Monte o fluxo abaixo. Ele é exibido para o cliente ao abrir o chat.
                </p>
                <FluxoBuilder fluxo={fluxo} setFluxo={setFluxo} />
              </div>
            </Card>
            )}



            {mostraChat && metricas && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Card className="border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" /> Finalizados
                    </div>
                    <p className="mt-1 text-2xl font-bold">{metricas.finalizados}</p>
                  </Card>
                  <Card className="border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MessageCircle className="h-4 w-4 text-primary" /> Em aberto
                    </div>
                    <p className="mt-1 text-2xl font-bold">{metricas.abertos}</p>
                  </Card>
                  <Card className="border-border/60 bg-card p-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Timer className="h-4 w-4 text-primary" /> Tempo médio resposta
                    </div>
                    <p className="mt-1 text-2xl font-bold">{metricas.tempoMedioMin} min</p>
                  </Card>
                </div>

                <Card className="border-border/60 bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold">Últimos 7 dias</h2>
                  <ChartContainer
                    config={{
                      finalizados: { label: "Finalizados", color: "hsl(var(--primary))" },
                      tempoEsperaMin: { label: "Espera (min)", color: "hsl(var(--muted-foreground))" },
                    }}
                    className="h-[220px] w-full"
                  >
                    <BarChart data={metricas.serie}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="dia" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={28} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="finalizados" fill="var(--color-finalizados)" radius={4} />
                      <Bar dataKey="tempoEsperaMin" fill="var(--color-tempoEsperaMin)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                </Card>
              </div>
            )}

            {mostraChat && (
              <Card className="overflow-hidden border-border/60 bg-card p-0">
                <div className="grid md:grid-cols-[280px_1fr]">
                  {/* Lista de conversas */}
                  <div className="flex h-[560px] flex-col border-b border-border/60 bg-muted/30 md:border-b-0 md:border-r">
                    <div className="border-b border-border/60 px-4 py-4">
                      <h2 className="text-lg font-bold">Chat</h2>
                      <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-background/60 p-1">
                        <button
                          onClick={() => { setAba("abertos"); setSelecionado(null); }}
                          className={`rounded-full py-1.5 text-xs font-medium transition-colors ${
                            aba === "abertos" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                          }`}
                        >
                          Abertos
                        </button>
                        <button
                          onClick={() => { setAba("encerrados"); setSelecionado(null); }}
                          className={`rounded-full py-1.5 text-xs font-medium transition-colors ${
                            aba === "encerrados" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                          }`}
                        >
                          Encerrados
                        </button>
                      </div>
                      <div className="relative mt-3">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={busca}
                          onChange={(e) => setBusca(e.target.value)}
                          placeholder="Pesquisar"
                          className="rounded-full border-transparent bg-background/60 pl-9"
                        />
                      </div>
                    </div>
                    <div className="flex-1 space-y-1 overflow-y-auto p-2">
                      {(() => {
                        const lista = conversas.filter(
                          (c) =>
                            Boolean(c.encerrada) === (aba === "encerrados") &&
                            (c.nome || c.email || "")
                              .toLowerCase()
                              .includes(busca.trim().toLowerCase()),
                        );
                        if (lista.length === 0) {
                          return (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                              {aba === "encerrados" ? "Nenhum chamado encerrado." : "Nenhuma conversa."}
                            </p>
                          );
                        }
                        return lista.map((c) => (
                            <button
                              key={c.userId}
                              onClick={() => setSelecionado(c)}
                              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted ${
                                selecionado?.userId === c.userId ? "bg-muted" : ""
                              }`}
                            >
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                                {(c.nome || c.email || "C").trim().charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium">
                                    {c.nome || c.email || "Cliente"}
                                  </span>
                                  {c.naoLidas > 0 && (
                                    <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                                      {c.naoLidas}
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {c.ultimaMensagem}
                                </span>
                              </div>
                            </button>
                          ));
                      })()}
                    </div>
                  </div>

                  {/* Painel da conversa */}
                  <div className="flex h-[560px] flex-col">
                    {!selecionado ? (
                      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Selecione uma conversa.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                            {(selecionado.nome || selecionado.email || "C").trim().charAt(0).toUpperCase()}
                          </div>
                          <span className="flex-1 truncate text-sm font-semibold">
                            {selecionado.nome || selecionado.email || "Cliente"}
                          </span>
                          {selecionado.encerrada ? (
                            <Button variant="outline" size="sm" onClick={reabrirChamado}>
                              <Clock className="mr-2 h-4 w-4" /> Reabrir
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={encerrarChamado}>
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Encerrar
                            </Button>
                          )}
                        </div>
                        {selecionado.encerrada && (
                          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-4 w-4 text-primary" /> Chamado encerrado
                          </div>
                        )}
                        <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 px-4 py-4">
                          {msgs.map((m) => (
                            <div
                              key={m.id}
                              className={`flex ${m.autor === "suporte" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                                  m.autor === "suporte"
                                    ? "rounded-br-md bg-primary text-primary-foreground"
                                    : "rounded-bl-md bg-card text-foreground shadow-sm"
                                }`}
                              >
                                {m.conteudo}
                              </div>
                            </div>
                          ))}
                          <div ref={fimRef} />
                        </div>
                        <div className="flex items-center gap-2 border-t border-border/60 p-3">
                          <Input
                            value={resposta}
                            onChange={(e) => setResposta(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                responder();
                              }
                            }}
                            placeholder="Escrever uma mensagem..."
                            className="rounded-full border-transparent bg-muted/50"
                          />
                          <Button
                            size="icon"
                            className="h-11 w-11 shrink-0 rounded-full"
                            onClick={responder}
                            disabled={enviando || !resposta.trim()}
                          >
                            {enviando ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
