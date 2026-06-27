// Server-only: integração com o Asaas (cobrança via Pix/Boleto/Cartão).
// Docs: https://docs.asaas.com/reference
// A credencial usada é a ASAAS_API_KEY (chave de API da sua conta Asaas).
// Opcional: ASAAS_ENV = "producao" (padrão) ou "sandbox".
import { getConfigKey } from "@/lib/system-config.server";

async function getBaseUrl(): Promise<string> {
  const env = (await getConfigKey("ASAAS_ENV"))?.toLowerCase().trim();
  return env === "sandbox"
    ? "https://api-sandbox.asaas.com/v3"
    : "https://api.asaas.com/v3";
}

async function getApiKey(): Promise<string> {
  const key = await getConfigKey("ASAAS_API_KEY");
  if (!key) {
    throw new Error(
      "Asaas não configurado. Adicione ASAAS_API_KEY em Admin → API de pagamento.",
    );
  }
  return key.trim();
}

async function asaasFetch(path: string, init: RequestInit): Promise<any> {
  const base = await getBaseUrl();
  const apiKey = await getApiKey();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg =
      json?.errors?.[0]?.description ?? `Falha na requisição Asaas (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

// Cria (ou reutiliza) um cliente no Asaas e retorna o id.
async function obterCliente(customer: {
  name?: string;
  email?: string;
  cpfCnpj?: string;
}): Promise<string> {
  // Tenta localizar por e-mail para evitar duplicidade.
  if (customer.email) {
    const found = await asaasFetch(
      `/customers?email=${encodeURIComponent(customer.email)}`,
      { method: "GET" },
    );
    if (Array.isArray(found?.data) && found.data[0]?.id) {
      return found.data[0].id as string;
    }
  }
  const created = await asaasFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: customer.name || "Cliente BilheteIA",
      email: customer.email,
      cpfCnpj: customer.cpfCnpj || undefined,
    }),
  });
  if (!created?.id) throw new Error("Não foi possível criar o cliente no Asaas");
  return created.id as string;
}

type CriarCobrancaParams = {
  descricao: string;
  valorReais: number; // ex.: 29.9
  externalReference: string; // userId|plano|ciclo
  vencimentoDias?: number;
  customer?: { name?: string; email?: string; cpfCnpj?: string };
};

// Cria uma cobrança e retorna a URL da fatura (invoiceUrl) para o pagamento.
export async function criarCobranca(
  params: CriarCobrancaParams,
): Promise<{ url: string; paymentId: string }> {
  const customerId = await obterCliente(params.customer ?? {});
  const due = new Date();
  due.setDate(due.getDate() + (params.vencimentoDias ?? 3));
  const dueDate = due.toISOString().slice(0, 10);

  const payment = await asaasFetch("/payments", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: "UNDEFINED", // cliente escolhe Pix/Boleto/Cartão
      value: Number(params.valorReais.toFixed(2)),
      dueDate,
      description: params.descricao,
      externalReference: params.externalReference,
    }),
  });

  const url = payment?.invoiceUrl;
  if (!url) throw new Error("Asaas não retornou o link de pagamento");
  return { url, paymentId: payment.id as string };
}

// Consulta o status de uma cobrança no Asaas.
export async function consultarPagamento(
  paymentId: string,
): Promise<{ paid: boolean; status: string }> {
  const payment = await asaasFetch(`/payments/${paymentId}`, { method: "GET" });
  const status: string = payment?.status ?? "";
  const paid = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(status);
  return { paid, status };
}
