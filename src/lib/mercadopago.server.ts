// BYOK Mercado Pago via REST (sem SDK Node, compatível com Worker).
// Token vem do ambiente (MERCADO_PAGO_ACCESS_TOKEN) ou do painel admin.
import { getConfigKey } from "@/lib/system-config.server";

const MP_BASE = "https://api.mercadopago.com";

async function mpToken(): Promise<string> {
  const token = await getConfigKey("MERCADO_PAGO_ACCESS_TOKEN");
  if (!token) {
    throw new Error(
      "Mercado Pago não configurado. Adicione MERCADO_PAGO_ACCESS_TOKEN em Admin → APIs do sistema.",
    );
  }
  return token;
}

async function mpFetch(path: string, init: RequestInit): Promise<any> {
  const token = await mpToken();
  const res = await fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message || body?.error || `Mercado Pago HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// Cria uma assinatura (preapproval) mensal em BRL e devolve o link de pagamento.
export async function createPreapproval(opts: {
  reason: string;
  valor: number; // em reais
  payerEmail: string;
  backUrl: string;
  externalReference: string;
}): Promise<{ id: string; init_point: string }> {
  const body = await mpFetch("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: opts.reason,
      external_reference: opts.externalReference,
      payer_email: opts.payerEmail,
      back_url: opts.backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: Number(opts.valor.toFixed(2)),
        currency_id: "BRL",
      },
      status: "pending",
    }),
  });
  return { id: body.id, init_point: body.init_point };
}

export async function getPreapproval(id: string): Promise<any> {
  return mpFetch(`/preapproval/${id}`, { method: "GET" });
}

// "R$ 1.299,90" -> 1299.90 (reais)
export function precoEmReais(preco: string): number {
  const cleaned = preco
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) throw new Error("Preço do plano inválido");
  return n;
}
