import { createFileRoute } from "@tanstack/react-router";

// Endpoint mantido apenas para compatibilidade com rotas geradas antigas.
// A integração bancária oficial do BilheteIA Pro agora é somente Asaas.
export const Route = createFileRoute("/api/public/payments/infinitepay")({
  server: {
    handlers: {
      POST: async () =>
        new Response(JSON.stringify({ ok: false, error: "InfinitePay desativado. Use Asaas." }), {
          status: 410,
          headers: { "Content-Type": "application/json" },
        }),
      GET: async () =>
        new Response(JSON.stringify({ ok: false, error: "InfinitePay desativado. Use Asaas." }), {
          status: 410,
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
