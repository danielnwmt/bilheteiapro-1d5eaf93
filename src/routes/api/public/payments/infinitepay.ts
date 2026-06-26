import { createFileRoute } from "@tanstack/react-router";
import { verificarPagamento } from "@/lib/infinitepay.server";

function getSupabaseAdmin() {
  return import("@/integrations/supabase/client.server").then((m) => m.supabaseAdmin);
}

// Webhook da InfinitePay: chamado quando um pagamento é aprovado.
// Payload inclui order_nsu (userId|plano|ts), slug, transaction_nsu e amount.
export const Route = createFileRoute("/api/public/payments/infinitepay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}) as any);
          const orderNsu: string = body?.order_nsu ?? "";
          const slug: string | undefined = body?.invoice_slug ?? body?.slug;
          const transactionNsu: string | undefined = body?.transaction_nsu;

          const [userId, plano, cicloRaw] = String(orderNsu).split("|");
          if (!userId || !plano) {
            return Response.json({ received: true, ignored: "order_nsu inválido" });
          }
          const ciclo = ["mensal", "semestral", "anual"].includes(cicloRaw) ? cicloRaw : "mensal";
          const mesesPorCiclo: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };

          // Confirma com a InfinitePay que o pagamento foi realmente pago.
          const { paid } = await verificarPagamento({ orderNsu, slug, transactionNsu });
          if (!paid) {
            return Response.json({ received: true, ignored: "não pago" });
          }

          const periodoFim = new Date();
          periodoFim.setMonth(periodoFim.getMonth() + (mesesPorCiclo[ciclo] ?? 1));

          const supabaseAdmin = await getSupabaseAdmin();
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              plano: (plano as "start" | "pro" | "elite") ?? "start",
              status: "ativo",
              stripe_subscription_id: `ip_${slug ?? transactionNsu ?? Date.now()}`,
              periodo_fim: periodoFim.toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          return Response.json({ received: true });
        } catch (e) {
          console.error("Erro no webhook InfinitePay:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
