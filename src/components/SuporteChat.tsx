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

export function SuporteChat({
  open,
  onOpenChange,
  whatsapp,
  mensagemPadrao,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  whatsapp?: string;
  mensagemPadrao?: string;
}) {
  const [userId, setUserId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const fimRef = useRef<HTMLDivElement | null>(null);

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
  }, [msgs, open]);

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
          ) : msgs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {mensagemPadrao || "Envie sua mensagem, responderemos em breve."}
            </p>
          ) : (
            msgs.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.autor === "cliente" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    m.autor === "cliente"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.conteudo}
                </div>
              </div>
            ))
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
