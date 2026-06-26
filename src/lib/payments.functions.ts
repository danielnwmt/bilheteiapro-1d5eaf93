import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { criarLinkPagamento, precoEmCentavos } from "@/lib/infinitepay.server";
import type { Plano } from "@/lib/planos";

type CheckoutResult = { url: string } | { error: string };



async function getPlanoConfig(plano: Plano): Promise<{ nome: string; preco: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("plano_config")
    .select("nome, preco")
    .eq("plano", plano)
    .maybeSingle();
  if (!data) throw new Error("Plano não encontrado");
  return { nome: data.nome, preco: data.preco };
}

// ============ INFINITEPAY (link de pagamento — Pix/Cartão) ============
export const createInfinitePayCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; returnUrl: string }) => {
    if (!data.plano) throw new Error("Plano inválido");
    return data;
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      const cfg = await getPlanoConfig(data.plano);

      // order_nsu carrega userId|plano para liberar o acesso no webhook.
      const orderNsu = `${userId}|${data.plano}|${Date.now()}`;
      const origin = new URL(data.returnUrl).origin;

      const { url } = await criarLinkPagamento({
        descricao: `BilheteIA PRO — ${cfg.nome}`,
        precoCentavos: precoEmCentavos(cfg.preco),
        orderNsu,
        redirectUrl: data.returnUrl,
        webhookUrl: `${origin}/api/public/payments/infinitepay`,
        customer: { name: user?.user_metadata?.nome, email: user?.email ?? undefined },
      });
      return { url };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Falha no InfinitePay" };
    }
  });
