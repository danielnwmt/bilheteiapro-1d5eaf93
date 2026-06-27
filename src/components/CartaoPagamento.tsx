import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Wifi, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { pagarComCartao } from "@/lib/payments.functions";
import type { Ciclo, Plano } from "@/lib/planos";

function detectarBandeira(num: string): string {
  const d = num.replace(/\D/g, "");
  if (/^4/.test(d)) return "VISA";
  if (/^5[1-5]/.test(d) || /^2[2-7]/.test(d)) return "MASTERCARD";
  if (/^3[47]/.test(d)) return "AMEX";
  if (/^(606282|3841)/.test(d)) return "HIPERCARD";
  if (/^(4011|4312|4389|5041|5067|6277|6362|6363|650)/.test(d)) return "ELO";
  return "";
}

function formatNumero(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

export function CartaoPagamento({
  plano,
  ciclo,
  precoLabel,
  onSucesso,
  onCancelar,
}: {
  plano: Plano;
  ciclo: Ciclo;
  precoLabel: string;
  onSucesso: () => void;
  onCancelar: () => void;
}) {
  const pagar = useServerFn(pagarComCartao);
  const [numero, setNumero] = useState("");
  const [nome, setNome] = useState("");
  const [mes, setMes] = useState("");
  const [ano, setAno] = useState("");
  const [cvv, setCvv] = useState("");
  const [cep, setCep] = useState("");
  const [enderecoNumero, setEnderecoNumero] = useState("");
  const [verso, setVerso] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);

  const bandeira = useMemo(() => detectarBandeira(numero), [numero]);

  async function onPagar() {
    setLoading(true);
    try {
      const res = await pagar({
        data: {
          plano,
          ciclo,
          cartao: {
            holderName: nome.trim(),
            number: numero.replace(/\s/g, ""),
            expiryMonth: mes.padStart(2, "0"),
            expiryYear: ano.length === 2 ? `20${ano}` : ano,
            ccv: cvv,
          },
          cep,
          numeroEndereco: enderecoNumero,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOk(true);
      toast.success("Pagamento aprovado! Plano liberado.");
      setTimeout(onSucesso, 1400);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao processar o pagamento");
    } finally {
      setLoading(false);
    }
  }

  if (ok) {
    return (
      <div className="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card p-10 text-center">
        <CheckCircle2 className="h-14 w-14 text-primary" />
        <h2 className="text-xl font-bold">Pagamento aprovado!</h2>
        <p className="text-sm text-muted-foreground">Seu plano já está ativo.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 grid max-w-4xl items-start gap-8 md:grid-cols-2">
      {/* Cartão visual */}
      <div className="[perspective:1200px]">
        <div
          className="relative h-56 w-full transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: verso ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* frente */}
          <div className="absolute inset-0 flex flex-col justify-between rounded-2xl bg-gradient-to-br from-primary to-primary/70 p-6 text-primary-foreground shadow-xl [backface-visibility:hidden]">
            <div className="flex items-start justify-between">
              <div className="h-9 w-12 rounded-md bg-primary-foreground/30" />
              <Wifi className="h-6 w-6 rotate-90 opacity-80" />
            </div>
            <div className="font-mono text-xl tracking-widest">
              {numero || "•••• •••• •••• ••••"}
            </div>
            <div className="flex items-end justify-between">
              <div className="min-w-0">
                <p className="text-[10px] uppercase opacity-70">Titular</p>
                <p className="truncate text-sm font-medium uppercase">
                  {nome || "NOME COMPLETO"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase opacity-70">Validade</p>
                <p className="text-sm font-medium">
                  {mes || "MM"}/{ano || "AA"}
                </p>
              </div>
            </div>
            {bandeira && (
              <span className="absolute right-6 top-6 text-xs font-bold tracking-wide">
                {bandeira}
              </span>
            )}
          </div>
          {/* verso */}
          <div className="absolute inset-0 flex flex-col rounded-2xl bg-gradient-to-br from-primary/80 to-primary/60 text-primary-foreground shadow-xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="mt-6 h-10 w-full bg-black/70" />
            <div className="px-6 pt-4">
              <div className="flex h-9 items-center justify-end rounded bg-primary-foreground px-3 font-mono text-sm text-foreground">
                {cvv || "•••"}
              </div>
              <p className="mt-2 text-right text-[10px] opacity-70">CVV</p>
            </div>
          </div>
        </div>
      </div>

      {/* Formulário */}
      <div className="rounded-2xl border border-border/60 bg-card p-6">
        <h2 className="text-lg font-bold">Dados do pagamento</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Total: <span className="font-semibold text-foreground">{precoLabel}</span>
        </p>

        <div className="mt-5 space-y-4">
          <div>
            <Label className="mb-1.5 block text-xs">Número do cartão</Label>
            <Input
              inputMode="numeric"
              placeholder="0000 0000 0000 0000"
              value={numero}
              onChange={(e) => setNumero(formatNumero(e.target.value))}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">Nome impresso no cartão</Label>
            <Input
              placeholder="NOME COMPLETO"
              value={nome}
              onChange={(e) => setNome(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Mês</Label>
              <Input
                inputMode="numeric"
                placeholder="MM"
                maxLength={2}
                value={mes}
                onChange={(e) => setMes(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Ano</Label>
              <Input
                inputMode="numeric"
                placeholder="AA"
                maxLength={4}
                value={ano}
                onChange={(e) => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">CVV</Label>
              <Input
                inputMode="numeric"
                placeholder="000"
                maxLength={4}
                value={cvv}
                onFocus={() => setVerso(true)}
                onBlur={() => setVerso(false)}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">CEP</Label>
              <Input
                inputMode="numeric"
                placeholder="00000-000"
                value={cep}
                onChange={(e) => setCep(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Nº endereço</Label>
              <Input
                placeholder="123"
                value={enderecoNumero}
                onChange={(e) => setEnderecoNumero(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button className="flex-1 font-semibold" disabled={loading} onClick={onPagar}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Pagar {precoLabel}
          </Button>
          <Button variant="outline" disabled={loading} onClick={onCancelar}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
