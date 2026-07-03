import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Send,
  LifeBuoy,
  Paperclip,
  Check,
  CheckCheck,
  ArrowLeft,
  Star,
  MessageSquarePlus,
} from "lucide-react";
import { toast } from "sonner";

type Mensagem = {
  id: string;
  autor: "cliente" | "suporte" | string;
  autor_nome?: string | null;
  conteudo: string;
  tipo?: string | null;
  arquivo_url?: string | null;
  arquivo_nome?: string | null;
  lida?: boolean;
  created_at: string;
};

type FluxoOpcao = { label: string; resposta: string; ouvidoria?: boolean };
type Fluxo = { saudacao: string; opcoes: FluxoOpcao[]; mensagens?: string[] };
type Bolha = { id: string; autor: "cliente" | "suporte"; conteudo: string };

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  aguardando_atendente: "Aguardando atendente",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando você",
  finalizado: "Finalizado",
};

// Preview de anexo (gera URL assinada do bucket privado).
function AnexoBolha({ path, nome }: { path: string; nome?: string | null }) {
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
  if (!url) return <span className="text-xs opacity-70">Carregando anexo…</span>;
  if (ehImagem) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={nome ?? "anexo"} className="max-h-48 rounded-md" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 underline">
      <Paperclip className="h-4 w-4" /> {nome ?? "Baixar arquivo"}
    </a>
  );
}

export function SuporteChat({
  open,
  onOpenChange,
  whatsapp,
  mensagemPadrao,
  fluxo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  whatsapp?: string;
  mensagemPadrao?: string;
  fluxo?: Fluxo;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("aberto");
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [fluxoLocal, setFluxoLocal] = useState<Bolha[]>([]);
  const [iniciado, setIniciado] = useState(false);
  const [modoReclamacao, setModoReclamacao] = useState(false);
  const [falandoAtendente, setFalandoAtendente] = useState(false);
  const [atendenteDigitando, setAtendenteDigitando] = useState(false);
  const [avaliando, setAvaliando] = useState(false);
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState("");
  const [avaliada, setAvaliada] = useState(false);
  const fimRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const canalRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const temFluxo = Boolean(fluxo && (fluxo.saudacao.trim() || fluxo.opcoes.length));
  const fluxoAtivo = iniciado || msgs.length > 0;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
  }, []);

  // Carrega a conversa ativa do cliente (não finalizada) + mensagens.
  useEffect(() => {
    if (!open || !userId) return;
    setCarregando(true);
    (async () => {
      const { data: conv } = await supabase
        .from("suporte_conversas")
        .select("id, status")
        .eq("user_id", userId)
        .neq("status", "finalizado")
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      const cId = (conv as any)?.id ?? null;
      setConversaId(cId);
      setStatus((conv as any)?.status ?? "aberto");
      if (cId) {
        setFalandoAtendente(true);
        const { data } = await supabase
          .from("suporte_mensagens")
          .select("id, autor, autor_nome, conteudo, tipo, arquivo_url, arquivo_nome, lida, created_at")
          .eq("conversa_id", cId)
          .order("created_at", { ascending: true });
        setMsgs((data as Mensagem[]) ?? []);
      } else {
        setMsgs([]);
      }
      setCarregando(false);
    })();
  }, [open, userId]);

  // Realtime da conversa ativa (mensagens + status + digitação).
  useEffect(() => {
    if (!open || !userId || !conversaId) return;

    const canal = supabase.channel(`conversa-${conversaId}`, { config: { presence: { key: userId } } });
    canalRef.current = canal;

    canal
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "suporte_mensagens", filter: `conversa_id=eq.${conversaId}` },
        (payload) => {
          const nova = payload.new as Mensagem;
          setMsgs((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "suporte_mensagens", filter: `conversa_id=eq.${conversaId}` },
        (payload) => {
          const upd = payload.new as Mensagem;
          setMsgs((prev) => prev.map((m) => (m.id === upd.id ? { ...m, ...upd } : m)));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "suporte_conversas", filter: `id=eq.${conversaId}` },
        (payload) => {
          const st = (payload.new as any).status as string;
          setStatus(st);
          if (st === "finalizado") setAvaliando(true);
        },
      )
      .on("broadcast", { event: "typing" }, (p) => {
        if ((p.payload as any)?.autor === "suporte") {
          setAtendenteDigitando(true);
          if (typingTimeout.current) clearTimeout(typingTimeout.current);
          typingTimeout.current = setTimeout(() => setAtendenteDigitando(false), 2500);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
      canalRef.current = null;
    };
  }, [open, userId, conversaId]);

  // Marca mensagens do atendente como lidas.
  useEffect(() => {
    if (!conversaId) return;
    const naoLidas = msgs.filter((m) => m.autor === "suporte" && !m.lida);
    if (naoLidas.length === 0) return;
    supabase
      .from("suporte_mensagens")
      .update({ lida: true })
      .eq("conversa_id", conversaId)
      .eq("autor", "suporte")
      .eq("lida", false)
      .then(() => {});
  }, [msgs, conversaId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, fluxoLocal, open, atendenteDigitando, avaliando]);

  // Garante que exista uma conversa para persistir mensagens.
  async function ensureConversa(novoStatus?: string): Promise<string | null> {
    if (conversaId) return conversaId;
    if (!userId) return null;
    const { data, error } = await supabase
      .from("suporte_conversas")
      .insert({ user_id: userId, status: novoStatus ?? "aberto" })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Não foi possível iniciar o atendimento");
      return null;
    }
    setConversaId((data as any).id);
    supabase.from("chatbot_logs").insert({
      user_id: userId,
      conversa_id: (data as any).id,
      evento: "cliente_iniciou",
      detalhes: {},
    });
    return (data as any).id;
  }

  function broadcastTyping() {
    canalRef.current?.send({ type: "broadcast", event: "typing", payload: { autor: "cliente" } });
  }

  function voltarAoMenu() {
    setModoReclamacao(false);
    setFluxoLocal((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, autor: "suporte", conteudo: fluxo?.saudacao || "Selecione uma opção:" },
    ]);
  }

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || !userId || enviando) return;
    setEnviando(true);

    if (modoReclamacao) {
      const { error } = await supabase.from("reclamacoes").insert({ user_id: userId, conteudo });
      setEnviando(false);
      if (error) return;
      setTexto("");
      setModoReclamacao(false);
      setFluxoLocal((prev) => [
        ...prev,
        { id: `cli-${Date.now()}`, autor: "cliente", conteudo },
        {
          id: `bot-${Date.now() + 1}`,
          autor: "suporte",
          conteudo: "Sua reclamação foi registrada na ouvidoria. Obrigado!",
        },
      ]);
      return;
    }

    const cId = await ensureConversa("aguardando_atendente");
    if (!cId) {
      setEnviando(false);
      return;
    }
    const { error } = await supabase
      .from("suporte_mensagens")
      .insert({ user_id: userId, conversa_id: cId, autor: "cliente", conteudo });
    setEnviando(false);
    if (!error) setTexto("");
  }

  async function escolherOpcao(op: FluxoOpcao) {
    if (!userId) return;
    setFluxoLocal((prev) => [...prev, { id: `cli-${Date.now()}`, autor: "cliente", conteudo: op.label }]);

    if (op.ouvidoria) {
      setModoReclamacao(true);
      setFluxoLocal((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          autor: "suporte",
          conteudo: op.resposta.trim() || "Descreva sua reclamação abaixo. Ela será registrada na ouvidoria.",
        },
      ]);
      return;
    }

    const cId = await ensureConversa("aberto");
    if (cId) {
      await supabase
        .from("suporte_mensagens")
        .insert({ user_id: userId, conversa_id: cId, autor: "cliente", conteudo: op.label });
      supabase.from("chatbot_logs").insert({
        user_id: userId,
        conversa_id: cId,
        evento: "cliente_escolheu",
        detalhes: { opcao: op.label },
      });
    }
    if (op.resposta.trim()) {
      setFluxoLocal((prev) => [...prev, { id: `bot-${Date.now()}`, autor: "suporte", conteudo: op.resposta }]);
    }
  }

  async function falarComAtendente() {
    if (!userId) return;
    const cId = await ensureConversa("aguardando_atendente");
    if (!cId) return;
    await supabase
      .from("suporte_conversas")
      .update({ status: "aguardando_atendente" })
      .eq("id", cId);
    await supabase.from("suporte_mensagens").insert({
      user_id: userId,
      conversa_id: cId,
      autor: "cliente",
      conteudo: "📞 Solicitou falar com um atendente",
    });
    supabase.from("chatbot_logs").insert({
      user_id: userId,
      conversa_id: cId,
      evento: "cliente_iniciou_atendimento",
      detalhes: {},
    });
    setFalandoAtendente(true);
    setStatus("aguardando_atendente");
    toast.success("Um atendente foi notificado. Aguarde um instante.");
  }

  async function uploadArquivo(file: File) {
    if (!userId) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx. 20MB).");
      return;
    }
    const cId = await ensureConversa("aguardando_atendente");
    if (!cId) return;
    const path = `${userId}/${cId}/${Date.now()}-${file.name}`;
    setEnviando(true);
    const { error: upErr } = await supabase.storage.from("suporte-anexos").upload(path, file);
    if (upErr) {
      setEnviando(false);
      toast.error("Falha no upload");
      return;
    }
    await supabase.from("suporte_mensagens").insert({
      user_id: userId,
      conversa_id: cId,
      autor: "cliente",
      conteudo: "",
      tipo: "arquivo",
      arquivo_url: path,
      arquivo_nome: file.name,
    });
    setEnviando(false);
  }

  async function enviarAvaliacao() {
    if (!userId || !conversaId || nota === 0) return;
    await supabase.from("avaliacoes").insert({
      conversa_id: conversaId,
      user_id: userId,
      nota,
      comentario: comentario.trim() || null,
    });
    setAvaliada(true);
    toast.success("Obrigado pela avaliação!");
  }

  function novoAtendimento() {
    setConversaId(null);
    setStatus("aberto");
    setMsgs([]);
    setFluxoLocal([]);
    setIniciado(false);
    setModoReclamacao(false);
    setFalandoAtendente(false);
    setAvaliando(false);
    setAvaliada(false);
    setNota(0);
    setComentario("");
  }

  const mostraMenu =
    temFluxo && fluxo!.opcoes.length > 0 && !falandoAtendente && !modoReclamacao && status !== "finalizado";
  const mostraInput = falandoAtendente || modoReclamacao || (!temFluxo);

  const digitandoBolha = atendenteDigitando ? (
    <div className="flex justify-start">
      <div className="rounded-lg bg-muted px-3 py-2 text-sm italic text-muted-foreground">
        Atendente está digitando…
      </div>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-h-[600px] flex-col p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <LifeBuoy className="h-5 w-5 text-primary" /> Suporte
            </span>
            {falandoAtendente && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
                {STATUS_LABEL[status] ?? status}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {carregando ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {temFluxo && !fluxoAtivo && (
                <div className="flex flex-col items-center justify-center gap-4 py-10 text-center">
                  <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                    {mensagemPadrao || "Olá! Como podemos ajudar você hoje?"}
                  </div>
                  <Button onClick={() => setIniciado(true)}>Iniciar atendimento</Button>
                </div>
              )}

              {(fluxoAtivo || fluxoLocal.length > 0) && fluxo?.saudacao.trim() && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                    {fluxo.saudacao}
                  </div>
                </div>
              )}

              {(fluxoAtivo || fluxoLocal.length > 0) &&
                (fluxo?.mensagens ?? []).map((m, i) => (
                  <div key={`extra-${i}`} className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{m}</div>
                  </div>
                ))}

              {!temFluxo && msgs.length === 0 && fluxoLocal.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {mensagemPadrao || "Envie sua mensagem, responderemos em breve."}
                </p>
              )}

              {fluxoLocal.map((m) => (
                <div key={m.id} className={`flex ${m.autor === "cliente" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.autor === "cliente" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {m.conteudo}
                  </div>
                </div>
              ))}

              {msgs.map((m) => (
                <div key={m.id} className={`flex ${m.autor === "cliente" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.autor === "cliente" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {m.autor === "suporte" && m.autor_nome && (
                      <p className="mb-0.5 text-[11px] font-semibold opacity-80">{m.autor_nome}</p>
                    )}
                    {m.tipo === "arquivo" && m.arquivo_url ? (
                      <AnexoBolha path={m.arquivo_url} nome={m.arquivo_nome} />
                    ) : (
                      m.conteudo
                    )}
                    {m.autor === "cliente" && (
                      <span className="ml-1 inline-flex translate-y-0.5 opacity-80">
                        {m.lida ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {digitandoBolha}

              {/* Menu de opções */}
              {mostraMenu && (
                <div className="flex flex-col items-start gap-2 pt-1">
                  <p className="text-xs text-muted-foreground">Selecione uma opção:</p>
                  {fluxo!.opcoes.map((op, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => escolherOpcao(op)}
                    >
                      {op.label}
                    </Button>
                  ))}
                  <Button size="sm" className="rounded-full" onClick={falarComAtendente}>
                    📞 Falar com atendente
                  </Button>
                </div>
              )}

              {/* Voltar ao menu */}
              {(modoReclamacao || (falandoAtendente && temFluxo)) && status !== "finalizado" && (
                <div className="pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary"
                    onClick={voltarAoMenu}
                  >
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar ao menu
                  </Button>
                </div>
              )}

              {/* Avaliação ao finalizar */}
              {avaliando && !avaliada && (
                <div className="mt-2 rounded-lg border border-border/60 bg-card p-4 text-center">
                  <p className="mb-2 text-sm font-medium">Como foi seu atendimento?</p>
                  <div className="mb-3 flex justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setNota(n)}>
                        <Star
                          className={`h-7 w-7 ${n <= nota ? "fill-primary text-primary" : "text-muted-foreground"}`}
                        />
                      </button>
                    ))}
                  </div>
                  <Input
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Comentário (opcional)"
                    className="mb-3"
                  />
                  <Button size="sm" disabled={nota === 0} onClick={enviarAvaliacao}>
                    Enviar avaliação
                  </Button>
                </div>
              )}

              {status === "finalizado" && (avaliada || !avaliando) && (
                <div className="mt-2 flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-muted-foreground">Atendimento finalizado.</p>
                  <Button variant="outline" size="sm" onClick={novoAtendimento}>
                    <MessageSquarePlus className="mr-1 h-4 w-4" /> Iniciar outro atendimento
                  </Button>
                </div>
              )}
            </>
          )}
          <div ref={fimRef} />
        </div>

        {whatsapp && status !== "finalizado" && (
          <div className="border-t border-border/60 px-4 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                window.open(
                  `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(mensagemPadrao || "Olá! Preciso de ajuda.")}`,
                  "_blank",
                )
              }
            >
              Falar pelo WhatsApp
            </Button>
          </div>
        )}

        {mostraInput && status !== "finalizado" && (
          <div className="flex items-center gap-2 border-t border-border/60 p-3">
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
            {!modoReclamacao && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fileRef.current?.click()}
                disabled={enviando}
                title="Anexar arquivo"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            )}
            <Input
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                if (falandoAtendente) broadcastTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder={modoReclamacao ? "Descreva sua reclamação..." : "Digite sua mensagem..."}
            />
            <Button size="icon" onClick={enviar} disabled={enviando || !texto.trim()}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
