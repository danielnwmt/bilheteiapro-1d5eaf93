import Stripe from "stripe";
import { getConfigKey } from "@/lib/system-config.server";

// BYOK: usa a chave secreta da conta Stripe do próprio cliente.
// A chave pode vir do ambiente (STRIPE_SECRET_KEY) ou do painel admin
// (tabela system_config), via getConfigKey.

export async function createStripeClient(): Promise<Stripe> {
  const secretKey = await getConfigKey("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw new Error(
      "Stripe não configurado. Adicione STRIPE_SECRET_KEY em Admin → APIs do sistema.",
    );
  }
  return new Stripe(secretKey, {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
  });
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

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as {
      message?: string;
      raw?: { message?: string };
    };
    return e.raw?.message ?? e.message ?? "Falha na requisição ao Stripe";
  }
  return "Falha na requisição ao Stripe";
}

// Verifica a assinatura do webhook do Stripe (HMAC SHA-256) usando o
// STRIPE_WEBHOOK_SECRET configurado.
export async function verifyStripeWebhook(
  req: Request,
): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = await getConfigKey("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET não configurado");
  if (!signature || !body) throw new Error("Assinatura ou corpo ausente");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) {
    throw new Error("Formato de assinatura inválido");
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook expirado");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = Buffer.from(new Uint8Array(signed)).toString("hex");
  if (!v1Signatures.includes(expected)) {
    throw new Error("Assinatura do webhook inválida");
  }
  return JSON.parse(body);
}
