import { createFileRoute } from "@tanstack/react-router";
import { getConfigKey } from "@/lib/system-config.server";

function getSupabaseAdmin() {
  return import("@/integrations/supabase/client.server").then((m) => m.supabaseAdmin);
}

const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
const EVENTOS_PAGOS = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"];

// Webhook do Asaas: chamado quando uma cobrança muda de status.
// Payload: { event, payment: { externalReference, status, id, ... } }
// Configure este endpoint em Asaas → Integrações → Webhooks.
// (opcional) defina ASAAS_WEBHOOK_TOKEN para validar o cabeçalho asaas-access-token.
export const Route = createFileRoute("/api/public/payments/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Validação opcional do token do webhook.
          const expectedToken = await getConfigKey("ASAAS_WEBHOOK_TOKEN");
          if (expectedToken) {
            const received = request.headers.get("asaas-access-token");
            if (received !== expectedToken) {
              return new Response("Unauthorized", { status: 401 });
            }
          }

          const body = (await request.json().catch(() => ({}))) as any;
          const event: string = body?.event ?? "";
          const payment = body?.payment ?? {};
          const externalReference: string = payment?.externalReference ?? "";
          const status: string = payment?.status ?? "";

          if (!EVENTOS_PAGOS.includes(event) || !STATUS_PAGOS.includes(status)) {
            return Response.json({ received: true, ignored: `evento ${event}/${status}` });
          }

          const [userId, plano, cicloRaw] = String(externalReference).split("|");
          if (!userId || !plano) {
            return Response.json({ received: true, ignored: "externalReference inválido" });
          }
          const ciclo = ["mensal", "semestral", "anual"].includes(cicloRaw) ? cicloRaw : "mensal";
          const mesesPorCiclo: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };

          const periodoFim = new Date();
          periodoFim.setMonth(periodoFim.getMonth() + (mesesPorCiclo[ciclo] ?? 1));

          const supabaseAdmin = await getSupabaseAdmin();
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              plano: (plano as "start" | "pro" | "elite") ?? "start",
              status: "ativo",
              stripe_subscription_id: `asaas_${payment?.id ?? Date.now()}`,
              periodo_fim: periodoFim.toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
          return Response.json({ received: true });
        } catch (e) {
          console.error("Erro no webhook Asaas:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
