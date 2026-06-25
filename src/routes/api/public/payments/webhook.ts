import { createFileRoute } from "@tanstack/react-router";
import { verifyStripeWebhook } from "@/lib/stripe.server";

function getSupabaseAdmin() {
  return import("@/integrations/supabase/client.server").then((m) => m.supabaseAdmin);
}

function planoFromMetadata(obj: any): "start" | "pro" | "elite" | null {
  const p = obj?.metadata?.plano;
  if (p === "start" || p === "pro" || p === "elite") return p;
  return null;
}

function appStatus(stripeStatus: string): string {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "ativo";
  if (
    stripeStatus === "canceled" ||
    stripeStatus === "unpaid" ||
    stripeStatus === "incomplete_expired"
  )
    return "inativo";
  return stripeStatus;
}

async function upsertFromSubscription(subscription: any) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("Sem userId no metadata da assinatura");
    return;
  }
  const item = subscription.items?.data?.[0];
  const plano = planoFromMetadata(subscription);
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const supabaseAdmin = await getSupabaseAdmin();
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      plano: plano ?? "start",
      status: appStatus(subscription.status),
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      periodo_fim: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

async function markCanceled(subscription: any) {
  const supabaseAdmin = await getSupabaseAdmin();
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "inativo", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id);
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const event = await verifyStripeWebhook(request);
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await upsertFromSubscription(event.data.object);
              break;
            case "customer.subscription.deleted":
              await markCanceled(event.data.object);
              break;
            default:
              console.log("Evento não tratado:", event.type);
          }
          return Response.json({ received: true });
        } catch (e) {
          console.error("Erro no webhook Stripe:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
