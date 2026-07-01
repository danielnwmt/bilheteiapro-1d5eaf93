// Autenticação simples para os endpoints de cron/hooks públicos.
// O cron (docker-compose / pg_cron) envia o cabeçalho `x-cron-secret` com o
// valor de CRON_SECRET. Sem o segredo configurado OU sem o cabeçalho correto,
// a chamada é rejeitada (401) — evita que qualquer pessoa dispare IA, backups
// e sincronizações à vontade.
export function verificarCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET não configurado no servidor" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
