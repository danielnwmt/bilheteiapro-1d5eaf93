// Registro de uso das APIs externas. Server-only.
// Soma +1 ao contador diário de chamadas de cada chave de API.
// Usa REST direto (service key) para evitar dependência de WebSocket no Node 20.

export async function registrarChamada(chave: string): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/increment_api_usage`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _chave: chave }),
    });
  } catch (e) {
    // Contagem de uso nunca deve quebrar uma chamada de API.
    console.error("registrarChamada falhou", e);
  }
}
