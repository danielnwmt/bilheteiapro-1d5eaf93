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
import { FluxoBuilder } from "@/components/FluxoBuilder";
import { SuporteAdminConfig } from "@/components/SuporteAdminConfig";

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
  const [fluxo, setFluxo] = useState<{ saudacao: string; opcoes: { label: string; resposta: string; ouvidoria?: boolean }[]; mensagens?: string[] }>({
    saudacao: "",
    opcoes: [],
    mensagens: [],
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
          mensagens: s.fluxo?.mensagens ?? [],
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
          .map((o) => ({ label: o.label.trim(), resposta: o.resposta.trim(), ouvidoria: Boolean(o.ouvidoria) }))
          .filter((o) => o.label),
        mensagens: (fluxo.mensagens ?? []).map((m) => m.trim()).filter(Boolean),
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
              <SuporteAdminConfig />
            </Card>
            )}


          </div>
        )}
      </div>
    </main>
  );
}
