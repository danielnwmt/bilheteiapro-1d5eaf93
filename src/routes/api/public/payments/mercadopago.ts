import { createFileRoute } from "@tanstack/react-router";
import { getPreapproval } from "@/lib/mercadopago.server";

function appStatus(mpStatus: string): string {
  if (mpStatus === "authorized") return "ativo";
  if (mpStatus === "paused" || mpStatus === "cancelled") return "inativo";
  return mpStatus;
}

export const Route = createFileRoute("/api/public/payments/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const body = await request.json().catch(() => ({} as any));
          // MP envia o id via querystring ou no corpo dependendo do tópico.
          const type = body?.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
          const id =
            body?.data?.id ??
            url.searchParams.get("data.id") ??
            url.searchParams.get("id");

          if (type !== "subscription_preapproval" && type !== "preapproval") {
            return Response.json({ received: true, ignored: type });
          }
          if (!id) return Response.json({ received: true, ignored: "sem id" });

          const pre = await getPreapproval(String(id));
          const ref: string = pre?.external_reference ?? "";
          const [userId, plano] = ref.split("|");
          if (!userId) return Response.json({ received: true, ignored: "sem ref" });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              plano: (plano as "start" | "pro" | "elite") ?? "start",
              status: appStatus(pre.status),
              stripe_subscription_id: `mp_${pre.id}`,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          return Response.json({ received: true });
        } catch (e) {
          console.error("Erro no webhook Mercado Pago:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
