import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { criarLinkPagamento } from "@/lib/infinitepay.server";
import { criarCobranca } from "@/lib/asaas.server";
import {
  CICLO_LABEL,
  precoCicloCentavos,
  type Ciclo,
  type Plano,
  type PlanoConfig,
} from "@/lib/planos";

type CheckoutResult = { url: string } | { error: string };

const CICLOS: Ciclo[] = ["mensal", "semestral", "anual"];

async function getPlanoConfig(plano: Plano): Promise<PlanoConfig> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("plano_config")
    .select("*")
    .eq("plano", plano)
    .maybeSingle();
  if (!data) throw new Error("Plano não encontrado");
  return {
    plano: data.plano,
    nome: data.nome,
    preco: data.preco,
    descricao: data.descricao ?? "",
    nivel: data.nivel ?? 0,
    priceId: data.price_id ?? "",
    historicoDias: data.historico_dias ?? 15,
    ligas: Array.isArray(data.ligas) ? (data.ligas as string[]) : [],
    recursos: (data.recursos ?? {}) as PlanoConfig["recursos"],
    descontoSemestral: Number((data as any).desconto_semestral ?? 0),
    descontoAnual: Number((data as any).desconto_anual ?? 0),
  };
}

// ============ INFINITEPAY (link de pagamento — Pix/Cartão) ============
export const createInfinitePayCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; ciclo?: Ciclo; returnUrl: string }) => {
    if (!data.plano) throw new Error("Plano inválido");
    const ciclo: Ciclo = CICLOS.includes(data.ciclo as Ciclo) ? (data.ciclo as Ciclo) : "mensal";
    return { plano: data.plano, ciclo, returnUrl: data.returnUrl };
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      const cfg = await getPlanoConfig(data.plano);
      const precoCentavos = precoCicloCentavos(cfg, data.ciclo);
      if (precoCentavos <= 0) throw new Error("Preço do plano inválido");

      // order_nsu carrega userId|plano|ciclo para liberar o acesso no webhook.
      const orderNsu = `${userId}|${data.plano}|${data.ciclo}|${Date.now()}`;
      const origin = new URL(data.returnUrl).origin;

      const { url } = await criarLinkPagamento({
        descricao: `BilheteIA PRO — ${cfg.nome} (${CICLO_LABEL[data.ciclo]})`,
        precoCentavos,
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

// ============ ASAAS (cobrança — Pix/Boleto/Cartão) ============
export const createAsaasCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; ciclo?: Ciclo; returnUrl: string }) => {
    if (!data.plano) throw new Error("Plano inválido");
    const ciclo: Ciclo = CICLOS.includes(data.ciclo as Ciclo) ? (data.ciclo as Ciclo) : "mensal";
    return { plano: data.plano, ciclo, returnUrl: data.returnUrl };
  })
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("nome, cpf")
        .eq("id", userId)
        .maybeSingle();

      const cfg = await getPlanoConfig(data.plano);
      const precoCentavos = precoCicloCentavos(cfg, data.ciclo);
      if (precoCentavos <= 0) throw new Error("Preço do plano inválido");

      // externalReference carrega userId|plano|ciclo para liberar o acesso no webhook.
      const externalReference = `${userId}|${data.plano}|${data.ciclo}`;

      const { url } = await criarCobranca({
        descricao: `BilheteIA PRO — ${cfg.nome} (${CICLO_LABEL[data.ciclo]})`,
        valorReais: precoCentavos / 100,
        externalReference,
        customer: {
          name: profile?.nome ?? user?.user_metadata?.nome,
          email: user?.email ?? undefined,
          cpfCnpj: (profile?.cpf ?? "").replace(/\D/g, "") || undefined,
        },
      });
      return { url };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Falha no Asaas" };
    }
  });

