// Server-only: integração com o checkout da InfinitePay (link de pagamento).
// Docs: POST https://api.infinitepay.io/invoices/public/checkout/links
// A chave de "banco" usada é o INFINITEPAY_HANDLE (sua InfiniteTag, sem o "$").
import { getConfigKey } from "@/lib/system-config.server";

const BASE = "https://api.infinitepay.io/invoices/public/checkout";

export async function getInfinitePayHandle(): Promise<string> {
  const handle = await getConfigKey("INFINITEPAY_HANDLE");
  if (!handle) {
    throw new Error(
      "InfinitePay não configurado. Adicione INFINITEPAY_HANDLE em Admin → API de pagamento.",
    );
  }
  return handle.replace(/^\$/, "").trim();
}

// "R$ 1.299,90" -> 129990 (centavos)
export function precoEmCentavos(preco: string): number {
  const cleaned = preco
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) throw new Error("Preço do plano inválido");
  return Math.round(n * 100);
}

type CriarLinkParams = {
  descricao: string;
  precoCentavos: number;
  orderNsu: string;
  redirectUrl: string;
  webhookUrl: string;
  customer?: { name?: string; email?: string };
};

export async function criarLinkPagamento(params: CriarLinkParams): Promise<{ url: string }> {
  const handle = await getInfinitePayHandle();
  const body: Record<string, unknown> = {
    handle,
    itens: [
      {
        quantity: 1,
        price: params.precoCentavos,
        description: params.descricao,
      },
    ],
    order_nsu: params.orderNsu,
    redirect_url: params.redirectUrl,
    webhook_url: params.webhookUrl,
  };
  if (params.customer?.name || params.customer?.email) {
    body.customer = {
      ...(params.customer.name && { name: params.customer.name }),
      ...(params.customer.email && { email: params.customer.email }),
    };
  }

  const res = await fetch(`${BASE}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Falha ao criar link InfinitePay (${res.status}). ${txt}`.trim());
  }
  const json = (await res.json()) as { link?: string; checkout_url?: string };
  const url = json.link ?? json.checkout_url;
  if (!url) throw new Error("InfinitePay não retornou o link de pagamento");
  return { url };
}

// Confirma no servidor da InfinitePay se o pagamento foi efetivamente pago.
export async function verificarPagamento(input: {
  orderNsu: string;
  transactionNsu?: string;
  slug?: string;
}): Promise<{ paid: boolean }> {
  const handle = await getInfinitePayHandle();
  const res = await fetch(`${BASE}/payment_check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      order_nsu: input.orderNsu,
      transaction_nsu: input.transactionNsu,
      slug: input.slug,
    }),
  });
  if (!res.ok) return { paid: false };
  const json = (await res.json()) as { success?: boolean; paid?: boolean };
  return { paid: !!json.paid };
}
