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
import { Loader2, Send, LifeBuoy } from "lucide-react";

type Mensagem = {
  id: string;
  autor: "cliente" | "suporte";
  conteudo: string;
  created_at: string;
};

type FluxoOpcao = { label: string; resposta: string };
type Fluxo = { saudacao: string; opcoes: FluxoOpcao[]; mensagens?: string[] };

// Bolhas locais do fluxo automático (não persistidas no banco).
type Bolha = { id: string; autor: "cliente" | "suporte"; conteudo: string };

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
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [fluxoLocal, setFluxoLocal] = useState<Bolha[]>([]);
  const fimRef = useRef<HTMLDivElement | null>(null);

  const temFluxo = Boolean(fluxo && (fluxo.saudacao.trim() || fluxo.opcoes.length));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!open || !userId) return;
    setCarregando(true);
    supabase
      .from("suporte_mensagens")
      .select("id, autor, conteudo, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setMsgs((data as Mensagem[]) ?? []);
        setCarregando(false);
      });

    const canal = supabase
      .channel(`suporte-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "suporte_mensagens", filter: `user_id=eq.${userId}` },
        (payload) => {
          const nova = payload.new as Mensagem;
          setMsgs((prev) => (prev.some((m) => m.id === nova.id) ? prev : [...prev, nova]));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [open, userId]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, fluxoLocal, open]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || !userId || enviando) return;
    setEnviando(true);
    const { error } = await supabase
      .from("suporte_mensagens")
      .insert({ user_id: userId, autor: "cliente", conteudo });
    setEnviando(false);
    if (!error) setTexto("");
  }

  async function escolherOpcao(op: FluxoOpcao) {
    if (!userId) return;
    // Eco da escolha do cliente (local, para o fluxo do chatbot).
    setFluxoLocal((prev) => [
      ...prev,
      { id: `cli-${Date.now()}`, autor: "cliente", conteudo: op.label },
    ]);
    // Registra a escolha do cliente (persiste para o atendente ver).
    await supabase.from("suporte_mensagens").insert({ user_id: userId, autor: "cliente", conteudo: op.label });
    // Resposta automática do chatbot exibida localmente.
    if (op.resposta.trim()) {
      setFluxoLocal((prev) => [
        ...prev,
        { id: `bot-${Date.now()}`, autor: "suporte", conteudo: op.resposta },
      ]);
    }
  }

  // O menu do chatbot fica sempre disponível enquanto houver fluxo configurado.
  const mostraMenu = temFluxo && fluxo!.opcoes.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-h-[600px] flex-col p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="h-5 w-5 text-primary" /> Suporte
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {carregando ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {(temFluxo || msgs.length > 0 || fluxoLocal.length > 0) && fluxo?.saudacao.trim() && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                    {fluxo.saudacao}
                  </div>
                </div>
              )}

              {(temFluxo || msgs.length > 0 || fluxoLocal.length > 0) &&
                (fluxo?.mensagens ?? []).map((m, i) => (
                  <div key={`extra-${i}`} className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                      {m}
                    </div>
                  </div>
                ))}


              {!temFluxo && msgs.length === 0 && fluxoLocal.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {mensagemPadrao || "Envie sua mensagem, responderemos em breve."}
                </p>
              )}

              {msgs.map((m) => (
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

              {mostraMenu && fluxo && fluxo.opcoes.length > 0 && (
                <div className="flex flex-col items-start gap-2 pt-1">
                  {fluxo.opcoes.map((op, i) => (
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
                </div>
              )}
            </>
          )}
          <div ref={fimRef} />
        </div>

        {whatsapp && (
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

        <div className="flex items-center gap-2 border-t border-border/60 p-3">
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Digite sua mensagem..."
          />
          <Button size="icon" onClick={enviar} disabled={enviando || !texto.trim()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
