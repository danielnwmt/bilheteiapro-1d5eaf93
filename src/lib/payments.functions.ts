import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient, getStripeErrorMessage, precoEmCentavos } from "@/lib/stripe.server";
import { createPreapproval, precoEmReais } from "@/lib/mercadopago.server";
import type { Plano } from "@/lib/planos";

type CheckoutResult = { url: string } | { error: string };
type PortalResult = { url: string } | { error: string };

const PLANOS_VALIDOS: Plano[] = ["start", "pro", "elite"];

async function getPlanoConfig(plano: Plano): Promise<{ nome: string; preco: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("plano_config")
    .select("nome, preco")
    .eq("plano", plano)
    .maybeSingle();
  if (!data) throw new Error("Plano não encontrado");
  return { nome: data.nome, preco: data.preco };
}

// ============ STRIPE (BYOK, checkout hospedado) ============
export const createStripeCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; returnUrl: string }) => {
    if (!PLANOS_VALIDOS.includes(data.plano)) throw new Error("Plano inválido");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      const cfg = await getPlanoConfig(data.plano);
      const stripe = await createStripeClient();

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "brl",
              unit_amount: precoEmCentavos(cfg.preco),
              recurring: { interval: "month" },
              product_data: { name: `BilheteIA PRO — ${cfg.nome}` },
            },
          },
        ],
        ...(user?.email && { customer_email: user.email }),
        success_url: data.returnUrl,
        cancel_url: data.returnUrl,
        metadata: { userId, plano: data.plano },
        subscription_data: { metadata: { userId, plano: data.plano } },
      });

      if (!session.url) throw new Error("Não foi possível iniciar o checkout");
      return { url: session.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ============ MERCADO PAGO (BYOK, assinatura) ============
export const createMercadoPagoCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; returnUrl: string }) => {
    if (!PLANOS_VALIDOS.includes(data.plano)) throw new Error("Plano inválido");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error("E-mail do usuário não encontrado");
      const cfg = await getPlanoConfig(data.plano);

      const { init_point } = await createPreapproval({
        reason: `BilheteIA PRO — ${cfg.nome}`,
        valor: precoEmReais(cfg.preco),
        payerEmail: user.email,
        backUrl: data.returnUrl,
        externalReference: `${userId}|${data.plano}`,
      });
      return { url: init_point };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Falha no Mercado Pago" };
    }
  });

// ============ Portal de assinatura Stripe ============
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string }) => data)
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) throw new Error("Nenhuma assinatura encontrada");

    try {
      const stripe = await createStripeClient();
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
