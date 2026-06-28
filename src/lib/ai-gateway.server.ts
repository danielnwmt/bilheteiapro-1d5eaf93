import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getConfigKey } from "./system-config.server";
import { registrarChamada } from "./api-usage.server";

/**
 * Retorna o modelo de IA a ser usado para tratar os dados da API.
 *
 * Prioridade:
 * 1. GEMINI_API_KEY  -> usa o Gemini direto (Google AI Studio). Ideal para a VPS.
 * 2. LOVABLE_API_KEY -> usa o Lovable AI Gateway (ambiente Lovable).
 *
 * Configure GEMINI_MODEL para escolher o modelo (padrão: gemini-2.5-flash).
 */
export async function getAiModel(): Promise<LanguageModel> {
  const geminiKey = await getConfigKey("GEMINI_API_KEY");
  if (geminiKey) {
    const google = createOpenAICompatible({
      name: "google",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      headers: { Authorization: `Bearer ${geminiKey}` },
      supportsStructuredOutputs: true,
    });
    await registrarChamada("GEMINI_API_KEY");
    return google(process.env.GEMINI_MODEL || "gemini-2.5-flash");
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) {
    const gateway = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      supportsStructuredOutputs: true,
    });
    return gateway("google/gemini-3-flash-preview");
  }

  throw new Error(
    "IA não configurada. Defina GEMINI_API_KEY (chave do Google AI Studio) no .env.",
  );
}
