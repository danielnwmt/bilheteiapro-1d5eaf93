import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function planoFromPrice(price: any): "start" | "pro" | "elite" | null {
  const key: string =
    price?.lookup_key || price?.metadata?.lovable_external_id || "";
  if (key.startsWith("start")) return "start";
  if (key.startsWith("pro")) return "pro";
  if (key.startsWith("elite")) return "elite";
  return null;
}

// status do app: 'ativo' quando pago/em teste; senão o status do Stripe.
function appStatus(stripeStatus: string): string {
  if (stripeStatus === "active" || stripeStatus === "trialing") return "ativo";
  if (stripeStatus === "canceled" || stripeStatus === "unpaid" || stripeStatus === "incomplete_expired")
    return "inativo";
  return stripeStatus;
}

async function upsertFromSubscription(subscription: any) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const plano = planoFromPrice(item?.price);
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  await getSupabase()
    .from("subscriptions")
    .upsert(
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
  await getSupabase()
    .from("subscriptions")
    .update({ status: "inativo", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id);
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertFromSubscription(event.data.object);
      break;
    case "customer.subscription.deleted":
      await markCanceled(event.data.object);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
