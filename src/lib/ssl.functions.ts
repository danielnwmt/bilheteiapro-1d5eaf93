import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const ADMIN_EMAIL = "contato@protenexus.com";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function getAuthenticatedRequester() {
  const authHeader = getRequestHeader("authorization") ?? getRequestHeader("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Sessão expirada. Entre novamente e tente de novo.");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configuração do servidor incompleta.");

  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Sessão inválida. Entre novamente e tente de novo.");
  const user = await res.json();
  return { id: String(user?.id ?? ""), email: normalizeEmail(user?.email) };
}

async function userHasAdminRole(userId: string) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey || !userId || serviceKey.split(".").length !== 3) return false;
  try {
    const endpoint = new URL("/rest/v1/user_roles", url);
    endpoint.searchParams.set("select", "role");
    endpoint.searchParams.set("user_id", `eq.${userId}`);
    endpoint.searchParams.set("role", "eq.admin");
    const res = await fetch(endpoint, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function assertAdmin() {
  const user = await getAuthenticatedRequester();
  const isAdmin = user.email === ADMIN_EMAIL || (await userHasAdminRole(user.id));
  if (!isAdmin) throw new Error("Apenas admin pode instalar o SSL.");
}

function triggerDir() {
  const triggerFile = process.env.DEPLOY_TRIGGER_FILE || "/opt/app/deploy-trigger/request";
  // mesma pasta compartilhada com o host usada pelo botão "Atualizar sistema".
  return triggerFile.replace(/\/request$/, "");
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Solicita ao watcher do host a instalação/renovação do certificado SSL.
export const requestSsl = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        dominio: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Domínio inválido (ex: meusite.com.br)"),
        email: z.string().trim().toLowerCase().email("E-mail inválido"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await assertAdmin();

    const fs = await import("fs/promises");
    const path = await import("path");
    const dir = triggerDir();
    const heartbeatFile = path.join(dir, "watcher-alive");
    const sslRequestFile = path.join(dir, "ssl-request");

    async function watcherIsAlive(): Promise<boolean> {
      try {
        const raw = await fs.readFile(heartbeatFile, "utf8");
        const last = Number(String(raw).trim());
        if (!Number.isFinite(last)) return false;
        const age = Math.floor(Date.now() / 1000) - last;
        return age >= 0 && age < 180;
      } catch {
        return false;
      }
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      sslRequestFile,
      JSON.stringify({ dominio: data.dominio, email: data.email, ts: Date.now() }) + "\n",
      "utf8",
    );

    let alive = await watcherIsAlive();
    if (!alive) {
      await wait(7000);
      alive = await watcherIsAlive();
    }

    // O pedido já foi gravado no arquivo compartilhado. Mesmo quando o pulso não
    // aparece imediatamente (serviço reiniciando, clock/volume atrasado), o watcher
    // vai processar assim que estiver ativo. A UI não deve tratar isso como erro.
    return { ok: true, watcher: alive, queued: true, dominio: data.dominio };
  });

// Lê o status da última instalação de SSL gravado pelo watcher do host.
export const getSslStatus = createServerFn({ method: "GET" }).handler(async () => {
  await assertAdmin();
  const fs = await import("fs/promises");
  const path = await import("path");
  const statusFile = path.join(triggerDir(), "ssl-status");
  try {
    const raw = await fs.readFile(statusFile, "utf8");
    return { status: String(raw).trim() };
  } catch {
    return { status: "" };
  }
});
