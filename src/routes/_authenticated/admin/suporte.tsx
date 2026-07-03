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
import { ArrowLeft, Loader2, Save, ShieldAlert, LifeBuoy, Send, MessageSquare } from "lucide-react";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { getSuporte, setSystemConfig } from "@/lib/access.functions";
import { listSuporteConversas, type SuporteConversa } from "@/lib/suporte.functions";
import { toast } from "sonner";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin/suporte")({
  head: () => ({ meta: [{ title: "Suporte — Admin BilheteIA" }] }),
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
  const { data: access } = useAccess();
  const [currentEmail, setCurrentEmail] = useState("");
  const isAdmin = (access?.roles ?? []).includes("admin") || currentEmail === ADMIN_EMAIL;

  const carregarSuporte = useServerFn(getSuporte);
  const salvarConfig = useServerFn(setSystemConfig);
  const carregarConversas = useServerFn(listSuporteConversas);

  const [suporte, setSuporte] = useState({ whatsapp: "", email: "", mensagem: "", modo: "whatsapp" });
  const [conversas, setConversas] = useState<SuporteConversa[]>([]);
  const [selecionado, setSelecionado] = useState<SuporteConversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [resposta, setResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(String(data.session?.user?.email ?? "").trim().toLowerCase());
    });
  }, []);

  useEffect(() => {
    carregarSuporte()
      .then((s) =>
        setSuporte({
          whatsapp: s.whatsapp ?? "",
          email: s.email ?? "",
          mensagem: s.mensagem ?? "",
          modo: s.modo ?? "whatsapp",
        }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recarregarConversas() {
    carregarConversas()
      .then((c) => setConversas(c))
      .catch(() => {});
  }

  useEffect(() => {
    if (!isAdmin) return;
    recarregarConversas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

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

  const mostraChat = suporte.modo === "chat" || suporte.modo === "ambos";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Painel
          </Button>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <LifeBuoy className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Suporte</h1>
        </div>

        {!isAdmin ? (
          <Card className="flex items-center gap-3 border-border/60 bg-card p-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Apenas administradores podem acessar o suporte.
          </Card>
        ) : (
          <div className="space-y-6">
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
            </Card>

            {mostraChat && (
              <Card className="border-border/60 bg-card p-6">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-bold">Conversas</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                  <div className="space-y-1 md:max-h-[420px] md:overflow-y-auto">
                    {conversas.length === 0 ? (
                      <p className="py-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
                    ) : (
                      conversas.map((c) => (
                        <button
                          key={c.userId}
                          onClick={() => setSelecionado(c)}
                          className={`flex w-full flex-col rounded-md border border-border/60 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                            selecionado?.userId === c.userId ? "bg-muted" : ""
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2 font-medium">
                            <span className="truncate">{c.nome || c.email || "Cliente"}</span>
                            {c.naoLidas > 0 && (
                              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                                {c.naoLidas}
                              </span>
                            )}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{c.ultimaMensagem}</span>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="flex h-[420px] flex-col rounded-md border border-border/60">
                    {!selecionado ? (
                      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        Selecione uma conversa.
                      </div>
                    ) : (
                      <>
                        <div className="border-b border-border/60 px-3 py-2 text-sm font-medium">
                          {selecionado.nome || selecionado.email || "Cliente"}
                        </div>
                        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
                          {msgs.map((m) => (
                            <div
                              key={m.id}
                              className={`flex ${m.autor === "suporte" ? "justify-end" : "justify-start"}`}
                            >
                              <div
                                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                                  m.autor === "suporte"
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-foreground"
                                }`}
                              >
                                {m.conteudo}
                              </div>
                            </div>
                          ))}
                          <div ref={fimRef} />
                        </div>
                        <div className="flex items-center gap-2 border-t border-border/60 p-2">
                          <Input
                            value={resposta}
                            onChange={(e) => setResposta(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                responder();
                              }
                            }}
                            placeholder="Responder..."
                          />
                          <Button size="icon" onClick={responder} disabled={enviando || !resposta.trim()}>
                            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
