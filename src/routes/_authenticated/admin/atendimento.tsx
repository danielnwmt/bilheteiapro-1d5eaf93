import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import {
  ArrowLeft,
  Loader2,
  Send,
  Search,
  ShieldAlert,
  Headset,
  Paperclip,
  Check,
  CheckCheck,
  UserCheck,
  CheckCircle2,
  Star,
  Tag,
} from "lucide-react";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import {
  listConversasStaff,
  getConversaStaff,
  assumirConversa,
  setStatusConversa,
  setTagsConversa,
  enviarMensagemStaff,
  finalizarConversa,
  getDashboardSuporte,
  listRespostasRapidas,
  type ConversaStaff,
  type MensagemStaff,
  type DashboardSuporte,
  type RespostaRapida,
  type StatusConversa,
} from "@/lib/suporte-conversas.functions";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/atendimento")({
  head: () => ({ meta: [{ title: "Atendimento — Admin BilheteIA" }] }),
  component: AtendimentoPage,
});

const STATUS: Record<StatusConversa, { label: string; cor: string }> = {
  aberto: { label: "Aberto", cor: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  aguardando_atendente: { label: "Aguardando atendente", cor: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  em_atendimento: { label: "Em atendimento", cor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  aguardando_cliente: { label: "Aguardando cliente", cor: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  finalizado: { label: "Finalizado", cor: "bg-muted text-muted-foreground" },
};

const TAGS = [
  "Pagamento",
  "Plano",
  "Bug",
  "Erro",
  "Login",
  "Financeiro",
  "Cancelamento",
  "Sugestão",
];

type FiltroTempo = "todos" | "hoje" | "ontem" | "7d" | "30d";
type FiltroStatus = "em_atendimento" | "aguardando" | "finalizados";

const STATUS_OPCOES: { v: FiltroStatus; l: string }[] = [
  { v: "aguardando", l: "Aguardando" },
  { v: "em_atendimento", l: "Em atendimento" },
  { v: "finalizados", l: "Finalizados" },
];

function dentroDoPeriodo(iso: string, filtro: FiltroTempo): boolean {
  if (filtro === "todos") return true;
  const d = new Date(iso);
  const agora = new Date();
  const hoje0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  if (filtro === "hoje") return d >= hoje0;
  if (filtro === "ontem") {
    const ontem0 = new Date(hoje0);
    ontem0.setDate(hoje0.getDate() - 1);
    return d >= ontem0 && d < hoje0;
  }
  const dias = filtro === "7d" ? 7 : 30;
  const limite = new Date(hoje0);
  limite.setDate(hoje0.getDate() - dias);
  return d >= limite;
}

function AtendimentoPage() {
  const router = useRouter();
  const { data: access } = useAccess();
  const [currentEmail, setCurrentEmail] = useState("");
  const [meuId, setMeuId] = useState<string | null>(null);
  const roles = (access?.roles ?? []) as string[];
  const isStaff =
    roles.includes("admin") ||
    roles.includes("supervisor") ||
    roles.includes("operador") ||
    currentEmail === ADMIN_EMAIL;

  const carregarConversas = useServerFn(listConversasStaff);
  const carregarMensagens = useServerFn(getConversaStaff);
  const assumir = useServerFn(assumirConversa);
  const mudarStatus = useServerFn(setStatusConversa);
  const mudarTags = useServerFn(setTagsConversa);
  const enviarMsg = useServerFn(enviarMensagemStaff);
  const finalizar = useServerFn(finalizarConversa);
  const carregarDashboard = useServerFn(getDashboardSuporte);
  const carregarRespostas = useServerFn(listRespostasRapidas);

  const [conversas, setConversas] = useState<ConversaStaff[]>([]);
  const [sel, setSel] = useState<ConversaStaff | null>(null);
  const [msgs, setMsgs] = useState<MensagemStaff[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [busca, setBusca] = useState("");
  const [fTempo, setFTempo] = useState<FiltroTempo>("todos");
  const [fStatus, setFStatus] = useState<FiltroStatus[]>([
    "aguardando",
    "em_atendimento",
    "finalizados",
  ]);
  const [dash, setDash] = useState<DashboardSuporte | null>(null);
  const [respostas, setRespostas] = useState<RespostaRapida[]>([]);
  const [clienteDigitando, setClienteDigitando] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
      setMeuId(data.session?.user?.id ?? null);
    });
  }, []);

  const recarregarLista = useCallback(() => {
    carregarConversas().then((c) => setConversas(c)).catch(() => {});
    carregarDashboard().then((d) => setDash(d)).catch(() => {});
  }, [carregarConversas, carregarDashboard]);

  useEffect(() => {
    if (!isStaff) return;
    recarregarLista();
    carregarRespostas().then((r) => setRespostas(r)).catch(() => {});
  }, [isStaff, recarregarLista, carregarRespostas]);

  // Realtime global: qualquer mudança recarrega a lista/dashboard.
  useEffect(() => {
    if (!isStaff) return;
    const canal = supabase
      .channel("staff-suporte-global")
      .on("postgres_changes", { event: "*", schema: "public", table: "suporte_conversas" }, () => recarregarLista())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "suporte_mensagens" }, () => recarregarLista())
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [isStaff, recarregarLista]);

  // Mensagens da conversa selecionada + realtime + digitação.
  useEffect(() => {
    if (!sel) return;
    carregarMensagens({ data: { conversaId: sel.id } })
      .then((m) => setMsgs(m))
      .catch(() => {});

    const canal = supabase.channel(`conversa-${sel.id}`, { config: { presence: { key: meuId ?? "staff" } } });
    canalRef.current = canal;
    canal
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "suporte_mensagens", filter: `conversa_id=eq.${sel.id}` },
        () => carregarMensagens({ data: { conversaId: sel.id } }).then((m) => setMsgs(m)).catch(() => {}),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "suporte_mensagens", filter: `conversa_id=eq.${sel.id}` },
        (payload) => {
          const upd = payload.new as any;
          setMsgs((prev) => prev.map((m) => (m.id === upd.id ? { ...m, lida: upd.lida } : m)));
        },
      )
      .on("broadcast", { event: "typing" }, (p) => {
        if ((p.payload as any)?.autor === "cliente") {
          setClienteDigitando(true);
          if (typingTimeout.current) clearTimeout(typingTimeout.current);
          typingTimeout.current = setTimeout(() => setClienteDigitando(false), 2500);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
      canalRef.current = null;
    };
  }, [sel, meuId, carregarMensagens]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, clienteDigitando]);

  function broadcastTyping() {
    canalRef.current?.send({ type: "broadcast", event: "typing", payload: { autor: "suporte" } });
  }

  async function responder() {
    const conteudo = texto.trim();
    if (!conteudo || !sel || enviando) return;
    setEnviando(true);
    try {
      const r = await enviarMsg({ data: { conversaId: sel.id, userId: sel.userId, conteudo } });
      setSel({
        ...sel,
        atendenteId: sel.atendenteId ?? meuId,
        atendenteNome: sel.atendenteNome ?? r.atendenteNome,
        status: "em_atendimento",
      });
      broadcastStatus("em_atendimento");
      setTexto("");
      recarregarLista();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao enviar");
    }
    setEnviando(false);
  }

  function broadcastStatus(status: StatusConversa) {
    canalRef.current?.send({ type: "broadcast", event: "status", payload: { status } });
  }

  async function onAssumir() {
    if (!sel) return;
    try {
      const r = await assumir({ data: { conversaId: sel.id } });
      setSel({ ...sel, atendenteId: meuId, atendenteNome: r.atendenteNome, status: "em_atendimento" });
      broadcastStatus("em_atendimento");
      toast.success("Atendimento assumido");
      recarregarLista();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao assumir");
    }
  }

  async function onStatus(status: StatusConversa) {
    if (!sel) return;
    await mudarStatus({ data: { conversaId: sel.id, status } });
    setSel({ ...sel, status });
    broadcastStatus(status);
    recarregarLista();
  }

  async function onFinalizar() {
    if (!sel) return;
    await finalizar({ data: { conversaId: sel.id } });
    setSel({ ...sel, status: "finalizado" });
    broadcastStatus("finalizado");
    toast.success("Atendimento finalizado");
    recarregarLista();
  }

  async function toggleTag(tag: string) {
    if (!sel) return;
    const tags = sel.tags.includes(tag) ? sel.tags.filter((t) => t !== tag) : [...sel.tags, tag];
    setSel({ ...sel, tags });
    await mudarTags({ data: { conversaId: sel.id, tags } });
    recarregarLista();
  }

  async function uploadArquivo(file: File) {
    if (!sel) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 20MB).");
      return;
    }
    const path = `${sel.userId}/${sel.id}/${Date.now()}-${file.name}`;
    setEnviando(true);
    const { error } = await supabase.storage.from("suporte-anexos").upload(path, file);
    if (error) {
      setEnviando(false);
      toast.error("Falha no upload");
      return;
    }
    await enviarMsg({
      data: {
        conversaId: sel.id,
        userId: sel.userId,
        conteudo: "",
        tipo: "arquivo",
        arquivoUrl: path,
        arquivoNome: file.name,
      },
    });
    setEnviando(false);
  }

  const mostraRespostas = texto.startsWith("/") && respostas.length > 0;
  const respostasFiltradas = respostas.filter((r) =>
    ("/" + r.atalho).toLowerCase().startsWith(texto.toLowerCase()),
  );

  const lista = conversas.filter((c) => {
    const q = busca.trim().toLowerCase();
    if (q) {
      const alvo = `${c.nome} ${c.email} ${c.telefone} ${c.userId} ${c.tags.join(" ")}`.toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    if (!dentroDoPeriodo(c.atualizadoEm, fTempo)) return false;
    const cat: FiltroStatus =
      c.status === "em_atendimento"
        ? "em_atendimento"
        : c.status === "finalizado"
          ? "finalizados"
          : "aguardando";
    if (!fStatus.includes(cat)) return false;
    return true;
  });

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <Headset className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Atendimento</h1>
        </div>

        {!isStaff ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas a equipe de suporte pode acessar esta área.
          </Card>
        ) : (
          <div className="space-y-6">
            {dash && (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { l: "Hoje", v: dash.hoje },
                  { l: "Ativos", v: dash.ativos },
                  { l: "Aguardando", v: dash.aguardando },
                  { l: "Finalizados", v: dash.finalizados },
                  { l: "Resp. média", v: `${dash.tempoRespostaMin}m` },
                  { l: "Avaliação", v: dash.avaliacaoMedia || "—" },
                ].map((k) => (
                  <Card key={k.l} className="border-border/60 bg-card p-3">
                    <p className="text-xs text-muted-foreground">{k.l}</p>
                    <p className="mt-0.5 text-xl font-bold">{k.v}</p>
                  </Card>
                ))}
              </div>
            )}

            <Card className="overflow-hidden border-border/60 bg-card p-0">
              <div className="grid lg:grid-cols-[320px_1fr]">
                {/* Lista */}
                <div className="flex h-[600px] flex-col border-b border-border/60 bg-muted/30 lg:border-b-0 lg:border-r">
                  <div className="space-y-3 border-b border-border/60 p-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        placeholder="Nome, e-mail, telefone, tag…"
                        className="rounded-full border-transparent bg-background/60 pl-9"
                      />
                    </div>
                    <div className="flex gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 flex-1 justify-between text-xs font-normal"
                          >
                            {fStatus.length === STATUS_OPCOES.length
                              ? "Todos"
                              : fStatus.length === 0
                                ? "Nenhum"
                                : `${fStatus.length} selecionados`}
                            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {STATUS_OPCOES.map((opt) => (
                            <DropdownMenuCheckboxItem
                              key={opt.v}
                              checked={fStatus.includes(opt.v)}
                              onCheckedChange={(ck) =>
                                setFStatus((prev) =>
                                  ck ? [...prev, opt.v] : prev.filter((s) => s !== opt.v),
                                )
                              }
                              onSelect={(e) => e.preventDefault()}
                            >
                              {opt.l}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Select value={fTempo} onValueChange={(v) => setFTempo(v as FiltroTempo)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos">Sempre</SelectItem>
                          <SelectItem value="hoje">Hoje</SelectItem>
                          <SelectItem value="ontem">Ontem</SelectItem>
                          <SelectItem value="7d">7 dias</SelectItem>
                          <SelectItem value="30d">30 dias</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex-1 space-y-1 overflow-y-auto p-2">
                    {lista.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conversa.</p>
                    ) : (
                      lista.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setSel(c)}
                          className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted ${
                            sel?.id === c.id ? "bg-muted" : ""
                          }`}
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                            {(c.nome || c.email || "C").trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{c.nome || c.email || "Cliente"}</span>
                              {c.naoLidas > 0 && (
                                <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                                  {c.naoLidas}
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{c.ultimaMensagem}</span>
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${STATUS[c.status].cor}`}>
                              {STATUS[c.status].label}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Conversa */}
                <div className="flex h-[600px] flex-col">
                  {!sel ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                      Selecione uma conversa.
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-border/60 px-4 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{sel.nome || sel.email || "Cliente"}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {sel.email}
                              {sel.telefone ? ` · ${sel.telefone}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!sel.atendenteId && sel.status !== "finalizado" && (
                              <Button size="sm" onClick={onAssumir}>
                                <UserCheck className="mr-1 h-4 w-4" /> Assumir
                              </Button>
                            )}
                            {sel.atendenteNome && (
                              <span className="text-xs text-muted-foreground">{sel.atendenteNome}</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Select value={sel.status} onValueChange={(v) => onStatus(v as StatusConversa)}>
                            <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(STATUS) as StatusConversa[]).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {STATUS[s].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {sel.status !== "finalizado" && (
                            <Button size="sm" variant="outline" onClick={onFinalizar}>
                              <CheckCircle2 className="mr-1 h-4 w-4" /> Finalizar
                            </Button>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <Tag className="mr-0.5 h-3.5 w-3.5 text-muted-foreground" />
                          {TAGS.map((t) => (
                            <button
                              key={t}
                              onClick={() => toggleTag(t)}
                              className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                                sel.tags.includes(t)
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground hover:bg-muted/70"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                        {msgs.map((m) => (
                          <div key={m.id} className={`flex ${m.autor === "suporte" ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                                m.autor === "suporte" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                              }`}
                            >
                              {m.tipo === "arquivo" && m.arquivoUrl ? (
                                <AnexoLink path={m.arquivoUrl} nome={m.arquivoNome} />
                              ) : (
                                m.conteudo
                              )}
                              {m.autor === "suporte" && (
                                <span className="ml-1 inline-flex translate-y-0.5 opacity-80">
                                  {m.lida ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {clienteDigitando && (
                          <div className="flex justify-start">
                            <div className="rounded-lg bg-muted px-3 py-2 text-sm italic text-muted-foreground">
                              Cliente está digitando…
                            </div>
                          </div>
                        )}
                        <div ref={fimRef} />
                      </div>

                      {sel.status !== "finalizado" && (
                        <div className="relative border-t border-border/60 p-3">
                          {mostraRespostas && (
                            <div className="absolute bottom-full left-3 mb-1 w-72 rounded-lg border border-border/60 bg-popover p-1 shadow-md">
                              {respostasFiltradas.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-muted-foreground">Nenhuma resposta rápida.</p>
                              ) : (
                                respostasFiltradas.map((r) => (
                                  <button
                                    key={r.id}
                                    onClick={() => setTexto(r.texto)}
                                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                                  >
                                    <span className="font-medium text-primary">/{r.atalho}</span>{" "}
                                    <span className="text-muted-foreground">{r.texto.slice(0, 40)}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              ref={fileRef}
                              type="file"
                              className="hidden"
                              accept="image/*,application/pdf,video/*"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadArquivo(f);
                                e.target.value = "";
                              }}
                            />
                            <Button size="icon" variant="ghost" onClick={() => fileRef.current?.click()} disabled={enviando}>
                              <Paperclip className="h-4 w-4" />
                            </Button>
                            <Input
                              value={texto}
                              onChange={(e) => {
                                setTexto(e.target.value);
                                broadcastTyping();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                  e.preventDefault();
                                  responder();
                                }
                              }}
                              placeholder="Digite / para respostas rápidas…"
                            />
                            <Button size="icon" onClick={responder} disabled={enviando || !texto.trim()}>
                              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function AnexoLink({ path, nome }: { path: string; nome?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    supabase.storage
      .from("suporte-anexos")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (ativo) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      ativo = false;
    };
  }, [path]);
  const ehImagem = /\.(png|jpe?g|gif|webp|bmp)$/i.test(nome ?? path);
  if (!url) return <span className="text-xs opacity-70">Carregando…</span>;
  if (ehImagem)
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={nome ?? "anexo"} className="max-h-40 rounded-md" />
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
      <Paperclip className="h-4 w-4" /> {nome ?? "Arquivo"}
    </a>
  );
}
