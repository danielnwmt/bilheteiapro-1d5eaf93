import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, CheckCircle2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { checarStatusPix } from "@/lib/payments.functions";
import { formatarReais } from "@/lib/planos";

export type PixData = {
  paymentId: string;
  encodedImage: string;
  payload: string;
  expirationDate?: string;
  valorCentavos: number;
};

export function PixPagamento({
  pix,
  nomePlano,
  onSucesso,
  onCancelar,
}: {
  pix: PixData;
  nomePlano: string;
  onSucesso: () => void;
  onCancelar: () => void;
}) {
  const checar = useServerFn(checarStatusPix);
  const [copiado, setCopiado] = useState(false);
  const [pago, setPago] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function verificar(manual = false) {
    if (manual) setVerificando(true);
    try {
      const res = await checar({ data: { paymentId: pix.paymentId } });
      if ("error" in res) {
        if (manual) toast.error(res.error);
        return;
      }
      if (res.paid) {
        setPago(true);
        if (timer.current) clearInterval(timer.current);
        toast.success("Pagamento confirmado! Plano liberado.");
        setTimeout(onSucesso, 1600);
      } else if (manual) {
        toast.info("Pagamento ainda não identificado. Tente novamente em instantes.");
      }
    } finally {
      if (manual) setVerificando(false);
    }
  }

  // Verifica automaticamente a cada 5s enquanto a tela estiver aberta.
  useEffect(() => {
    timer.current = setInterval(() => verificar(false), 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(pix.payload);
      setCopiado(true);
      toast.success("Código Pix copiado!");
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.");
    }
  }

  if (pago) {
    return (
      <div className="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card p-10 text-center">
        <CheckCircle2 className="h-14 w-14 text-primary" />
        <h2 className="text-xl font-bold">Pagamento confirmado!</h2>
        <p className="text-sm text-muted-foreground">Seu plano já está ativo.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-md rounded-2xl border border-border/60 bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Pague com Pix</h2>
          <p className="text-sm text-muted-foreground">{nomePlano}</p>
        </div>
        <span className="text-lg font-bold text-primary">
          {formatarReais(pix.valorCentavos)}
        </span>
      </div>

      <div className="flex flex-col items-center">
        <div className="rounded-xl border border-border/60 bg-white p-3">
          <img
            src={`data:image/png;base64,${pix.encodedImage}`}
            alt="QR Code Pix"
            className="h-56 w-56"
          />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-center text-sm text-muted-foreground">
          <QrCode className="h-4 w-4" />
          Escaneie o QR Code no app do seu banco
        </p>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs text-muted-foreground">
          Ou copie o código Pix (copia e cola):
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 truncate rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs">
            {pix.payload}
          </div>
          <Button size="sm" variant="outline" onClick={copiar} className="shrink-0">
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Aguardando o pagamento. A liberação é automática após a confirmação.
      </div>

      <div className="mt-6 flex gap-3">
        <Button className="flex-1 font-semibold" disabled={verificando} onClick={() => verificar(true)}>
          {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Já paguei
        </Button>
        <Button variant="outline" onClick={onCancelar}>
          Voltar
        </Button>
      </div>
    </div>
  );
}
