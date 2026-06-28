// Server-only: lê chaves de configuração (APIs) do ambiente OU do banco.
// Prioridade: process.env -> tabela system_config (preenchida no painel admin).
// Assim as chaves podem ser adicionadas manualmente após a instalação.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseFlow } from "./api-flow";

const cache = new Map<string, { value: string; at: number }>();
const TTL = 60_000; // 1 min

// Lê o fluxo configurado (qual API faz cada etapa).
export async function getApiFlow(): Promise<Record<string, string>> {
  const raw = await getConfigKey("API_FLUXO");
  return parseFlow(raw ?? null);
}

export async function getConfigKey(chave: string): Promise<string | undefined> {
  const env = process.env[chave];
  if (env) return env;

  const cached = cache.get(chave);
  if (cached && Date.now() - cached.at < TTL) return cached.value || undefined;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return undefined;

  try {
    const supabase = createClient<Database>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from("system_config")
      .select("valor")
      .eq("chave", chave)
      .maybeSingle();
    const value = data?.valor ?? "";
    cache.set(chave, { value, at: Date.now() });
    return value || undefined;
  } catch {
    return undefined;
  }
}
