import { createFileRoute } from "@tanstack/react-router";

// Chamado pelo cron a cada hora. Verifica o horário configurado e, se bater,
// gera o backup e envia ao Google Drive automaticamente.
export const Route = createFileRoute("/api/public/hooks/auto-backup")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { runScheduledBackup } = await import("@/lib/backup.functions");
          const out = await runScheduledBackup();
          return Response.json({ ok: true, ...out });
        } catch (e) {
          console.error("Erro no backup automático:", e);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }
      },
    },
  },
});
