import { createFileRoute } from "@tanstack/react-router";
import { verificarCronSecret } from "@/lib/cron-auth";

// Robô de análise: chamado pelo cron a cada 5 min. Analisa os jogos com odds
// salvas e grava o resultado em analise_cache. O cliente só lê desse cache.
export const Route = createFileRoute("/api/public/hooks/analisar-jogos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = verificarCronSecret(request);
        if (unauthorized) return unauthorized;
        try {
          const { preAnalisarTodos } = await import("@/lib/pre-analise.server");
          const result = await preAnalisarTodos();
          return Response.json(result);
        } catch (e) {
          console.error("Erro no robô de análise:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
