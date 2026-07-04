import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { criarCobranca, cobrarCartao } from "@/lib/asaas.server";
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
    historicoDias: data.historico_dias ?? 15,
    ligas: Array.isArray(data.ligas) ? (data.ligas as string[]) : [],
    recursos: (data.recursos ?? {}) as PlanoConfig["recursos"],
    descontoSemestral: Number((data as any).desconto_semestral ?? 0),
    descontoAnual: Number((data as any).desconto_anual ?? 0),
  };
}

// ============ ASAAS (cobrança — Pix/Boleto/Cartão) ============
export const createAsaasCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { plano: Plano; ciclo?: Ciclo; returnUrl: string; metodo?: "pix" | "cartao"; cpf?: string }) => {
    if (!data.plano) throw new Error("Plano inválido");
    const ciclo: Ciclo = CICLOS.includes(data.ciclo as Ciclo) ? (data.ciclo as Ciclo) : "mensal";
    const metodo: "pix" | "cartao" = data.metodo === "cartao" ? "cartao" : "pix";
    return { plano: data.plano, ciclo, returnUrl: data.returnUrl, metodo, cpf: (data.cpf ?? "").replace(/\D/g, "") };
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

      // CPF/CNPJ é obrigatório no Asaas. Usa o informado ou o do cadastro.
      const cpf = data.cpf || (profile?.cpf ?? "").replace(/\D/g, "");
      if (cpf.length !== 11 && cpf.length !== 14) {
        throw new Error("Informe um CPF ou CNPJ válido para gerar a cobrança.");
      }
      // Persiste o CPF no perfil para os próximos pagamentos.
      if (cpf && cpf !== (profile?.cpf ?? "").replace(/\D/g, "")) {
        await supabase.from("profiles").update({ cpf }).eq("id", userId);
      }

      // externalReference carrega userId|plano|ciclo para liberar o acesso no webhook.
      const externalReference = `${userId}|${data.plano}|${data.ciclo}`;

      const { url } = await criarCobranca({
        descricao: `BilheteIA PRO — ${cfg.nome} (${CICLO_LABEL[data.ciclo]})`,
        valorReais: precoCentavos / 100,
        externalReference,
        metodo: data.metodo,
        customer: {
          name: profile?.nome ?? user?.user_metadata?.nome,
          email: user?.email ?? undefined,
          cpfCnpj: cpf,
        },
      });
      return { url };

    } catch (error) {
      return { error: error instanceof Error ? error.message : "Falha no pagamento" };
    }
  });

// ============ CARTÃO (cobrança imediata, sem redirecionar) ============
type CartaoInput = {
  plano: Plano;
  ciclo?: Ciclo;
  parcelas?: number;
  cpf?: string;
  cartao: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
};

type CartaoResult = { ok: true; status: string } | { ok: false; error: string };

const MAX_PARCELAS: Record<Ciclo, number> = { mensal: 1, semestral: 6, anual: 12 };

export const pagarComCartao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CartaoInput) => {
    if (!data.plano) throw new Error("Plano inválido");
    const ciclo: Ciclo = CICLOS.includes(data.ciclo as Ciclo) ? (data.ciclo as Ciclo) : "mensal";
    const c = data.cartao;
    if (!c?.number || !c?.holderName || !c?.expiryMonth || !c?.expiryYear || !c?.ccv) {
      throw new Error("Preencha todos os dados do cartão");
    }
    const max = MAX_PARCELAS[ciclo];
    const parcelas = Math.min(Math.max(1, Math.round(Number(data.parcelas) || 1)), max);
    return { plano: data.plano, ciclo, parcelas, cartao: c, cpf: (data.cpf ?? "").replace(/\D/g, "") };
  })
  .handler(async ({ data, context }): Promise<CartaoResult> => {
    try {
      const { userId, supabase } = context;
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("nome, cpf, telefone")
        .eq("id", userId)
        .maybeSingle();

      const cfg = await getPlanoConfig(data.plano);
      const precoCentavos = precoCicloCentavos(cfg, data.ciclo);
      if (precoCentavos <= 0) throw new Error("Preço do plano inválido");

      const cpf = data.cpf || (profile?.cpf ?? "").replace(/\D/g, "");
      if (cpf.length !== 11 && cpf.length !== 14) {
        throw new Error("Informe um CPF ou CNPJ válido para o pagamento.");
      }
      if (cpf && cpf !== (profile?.cpf ?? "").replace(/\D/g, "")) {
        await supabase.from("profiles").update({ cpf }).eq("id", userId);
      }

      const externalReference = `${userId}|${data.plano}|${data.ciclo}`;
      const { paid, status } = await cobrarCartao({
        descricao: `BilheteIA PRO — ${cfg.nome} (${CICLO_LABEL[data.ciclo]})`,
        valorReais: precoCentavos / 100,
        externalReference,
        parcelas: data.parcelas,
        cartao: data.cartao,
        holder: {
          name: profile?.nome ?? user?.user_metadata?.nome ?? "Cliente",
          email: user?.email ?? "",
          cpfCnpj: cpf,
          phone: (profile?.telefone ?? "").toString(),
        },
      });

      if (!paid) {
        return { ok: false, error: "Pagamento não aprovado. Verifique os dados do cartão." };
      }

      // Aprovado: libera o plano imediatamente (o webhook confirma depois também).
      const mesesPorCiclo: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };
      const periodoFim = new Date();
      periodoFim.setMonth(periodoFim.getMonth() + (mesesPorCiclo[data.ciclo] ?? 1));
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("subscriptions").upsert(
        {
          user_id: userId,
          plano: data.plano as "start" | "pro" | "elite",
          status: "ativo",
          external_subscription_id: `asaas_card_${Date.now()}`,
          periodo_fim: periodoFim.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      return { ok: true, status };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Falha no pagamento" };
    }
  });



// ============ CANCELAR ASSINATURA ============
type CancelarResult = { ok: true } | { ok: false; error: string };

export const cancelarAssinatura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CancelarResult> => {
    try {
      const { userId } = context;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update({ status: "cancelado", updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) throw error;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Falha ao cancelar" };
    }
  });
