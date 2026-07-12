import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  criarCobranca,
  cobrarCartao,
  obterPixQrCode,
  consultarPagamento,
} from "@/lib/asaas.server";
import {
  CICLO_LABEL,
  precoCicloCentavos,
  type Ciclo,
  type Plano,
  type PlanoConfig,
} from "@/lib/planos";

const MESES_POR_CICLO: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };

// Libera/troca o plano do usuário. Grava via REST direto (service role) para
// funcionar tanto no Lovable Cloud quanto no self-host, onde o supabase-js pode
// falhar. Faz upsert por user_id, então troca de plano substitui o anterior.
async function ativarPlano(
  userId: string,
  plano: Plano,
  ciclo: Ciclo,
  externalId: string,
): Promise<boolean> {
  const meses = MESES_POR_CICLO[ciclo] ?? 1;
  const periodoFim = new Date();
  periodoFim.setMonth(periodoFim.getMonth() + meses);
  const row = {
    user_id: userId,
    plano,
    status: "ativo",
    external_subscription_id: externalId,
    periodo_fim: periodoFim.toISOString(),
    updated_at: new Date().toISOString(),
  };

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/subscriptions?on_conflict=user_id`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      });
      if (res.ok) return true;
      console.error("ativarPlano REST falhou:", res.status, await res.text().catch(() => ""));
    } catch (e) {
      console.error("ativarPlano REST erro:", e);
    }
  }

  // Fallback: supabase-js (Lovable Cloud).
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(row as any, { onConflict: "user_id" });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("ativarPlano supabase-js falhou:", e);
    return false;
  }
}

type CheckoutResult =
  | { url: string }
  | {
      pix: {
        paymentId: string;
        encodedImage: string;
        payload: string;
        expirationDate?: string;
        valorCentavos: number;
      };
    }
  | { error: string };

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

      // CPF/CNPJ é obrigatório no Asaas. Usa sempre o do cadastro do cliente.
      const cpf = (profile?.cpf ?? "").replace(/\D/g, "") || data.cpf;
      if (cpf.length !== 11 && cpf.length !== 14) {
        throw new Error("Cadastro sem CPF/CNPJ. Atualize seu cadastro para gerar a cobrança.");
      }

      // externalReference carrega userId|plano|ciclo para liberar o acesso no webhook.
      const externalReference = `${userId}|${data.plano}|${data.ciclo}`;

      const { url, paymentId } = await criarCobranca({
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

      // Pix: retorna os dados do QR Code para exibir numa tela própria no app.
      if (data.metodo === "pix") {
        const qr = await obterPixQrCode(paymentId);
        return {
          pix: {
            paymentId,
            encodedImage: qr.encodedImage,
            payload: qr.payload,
            expirationDate: qr.expirationDate,
            valorCentavos: precoCentavos,
          },
        };
      }

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

      const cpf = (profile?.cpf ?? "").replace(/\D/g, "") || data.cpf;
      if (cpf.length !== 11 && cpf.length !== 14) {
        throw new Error("Cadastro sem CPF/CNPJ. Atualize seu cadastro para pagar.");
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


// ============ CHECAR STATUS DO PIX ============
type StatusResult = { paid: boolean; status: string } | { error: string };

export const checarStatusPix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!data?.paymentId) throw new Error("Cobrança inválida");
    return { paymentId: data.paymentId };
  })
  .handler(async ({ data, context }): Promise<StatusResult> => {
    try {
      const { userId } = context;
      const { paid, status, externalReference } = await consultarPagamento(data.paymentId);

      // Ao confirmar, libera o plano na hora (não depende só do webhook).
      if (paid) {
        const [refUserId, plano, cicloRaw] = String(externalReference).split("|");
        // Só libera se a cobrança for do próprio usuário autenticado.
        if (refUserId === userId && plano) {
          const ciclo = ["mensal", "semestral", "anual"].includes(cicloRaw) ? cicloRaw : "mensal";
          const mesesPorCiclo: Record<string, number> = { mensal: 1, semestral: 6, anual: 12 };
          const periodoFim = new Date();
          periodoFim.setMonth(periodoFim.getMonth() + (mesesPorCiclo[ciclo] ?? 1));
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              plano: plano as "start" | "pro" | "elite",
              status: "ativo",
              external_subscription_id: `asaas_${data.paymentId}`,
              periodo_fim: periodoFim.toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        }
      }

      return { paid, status };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Falha ao consultar" };
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
