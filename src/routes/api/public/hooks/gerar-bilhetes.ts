import { createFileRoute } from "@tanstack/react-router";
import { verificarCronSecret } from "@/lib/cron-auth";

// Endpoint do robô: acorda (chamado pelo cron), gera o bilhete e volta a dormir.
export const Route = createFileRoute("/api/public/hooks/gerar-bilhetes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verificarCronSecret(request);
        if (unauthorized) return unauthorized;
        try {
          const { gerarTodosBilhetes } = await import("@/lib/auto-bilhete.server");
          const results = await gerarTodosBilhetes();
          return Response.json({ ok: true, results });
        } catch (e) {
          console.error("Erro no robô de bilhetes:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
