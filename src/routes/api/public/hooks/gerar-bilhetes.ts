import { createFileRoute } from "@tanstack/react-router";

// Endpoint do robô: acorda (chamado pelo cron), gera o bilhete e volta a dormir.
export const Route = createFileRoute("/api/public/hooks/gerar-bilhetes")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { gerarBilheteAutomatico } = await import("@/lib/auto-bilhete.server");
          const result = await gerarBilheteAutomatico();
          return Response.json(result);
        } catch (e) {
          console.error("Erro no robô de bilhetes:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
