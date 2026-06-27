import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

const ADMIN_EMAIL = "contato@protenexus.com";

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function getAuthenticatedRequester() {
  const authHeader = getRequestHeader("authorization") ?? getRequestHeader("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) throw new Error("Sessão expirada. Entre novamente e tente atualizar.");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Configuração do servidor incompleta.");

  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error("Sessão inválida. Entre novamente e tente atualizar.");
  const user = await res.json();
  return {
    id: String(user?.id ?? ""),
    email: normalizeEmail(user?.email),
  };
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
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function startDeployDirectly() {
  const { spawn } = await import("child_process");
  const cmd =
    'DIR="${APP_DIR:-}"; ' +
    'if [ -z "$DIR" ] || [ ! -f "$DIR/deploy.sh" ]; then ' +
    'DIR="$(for d in "$HOME/app" /root/app /home/*/app /opt/lovable/app /opt/app /app; do [ -f "$d/deploy.sh" ] && echo "$d" && break; done)"; ' +
    'fi; ' +
    'if [ -z "$DIR" ]; then echo "deploy.sh nao encontrado" > /tmp/deploy.log; exit 1; fi; ' +
    'cd "$DIR" && bash deploy.sh > deploy.log 2>&1';
  const child = spawn("bash", ["-lc", cmd], { detached: true, stdio: "ignore" });
  child.unref();
}

export const deploySystem = createServerFn({ method: "POST" })
  .handler(async () => {
    const user = await getAuthenticatedRequester();
    const isAdmin = user.email === ADMIN_EMAIL || (await userHasAdminRole(user.id));
    if (!isAdmin) throw new Error("Apenas admin pode atualizar o sistema");

    // O app roda dentro de um container (tudo-em-um). Ele NÃO consegue rodar
    // "docker compose"/"git" por dentro. Em vez disso, grava um arquivo-gatilho
    // numa pasta compartilhada com o host. Um watcher no host (update-watcher.sh,
    // instalado automaticamente pelo deploy.sh) detecta o gatilho e roda deploy.sh.
    const fs = await import("fs/promises");
    const path = await import("path");
    const triggerFile = process.env.DEPLOY_TRIGGER_FILE || "/opt/app/deploy-trigger/request";
    const triggerDir = path.dirname(triggerFile);
    const heartbeatFile = path.join(triggerDir, "watcher-alive");

    // Verifica se o watcher do host está vivo (pulso atualizado nos últimos 60s).
    async function watcherIsAlive(): Promise<boolean> {
      try {
        const raw = await fs.readFile(heartbeatFile, "utf8");
        const last = Number(String(raw).trim());
        if (!Number.isFinite(last)) return false;
        const ageSeconds = Math.floor(Date.now() / 1000) - last;
        return ageSeconds >= 0 && ageSeconds < 60;
      } catch {
        return false;
      }
    }

    try {
      await fs.mkdir(triggerDir, { recursive: true });
      await fs.writeFile(triggerFile, `${Date.now()}\n`, "utf8");

      const alive = await watcherIsAlive();
      if (!alive) {
        // Sem watcher: roda o deploy.sh direto na VPS (instalações Node fora do container).
        await startDeployDirectly();
        return { ok: true, mode: "spawn" as const, watcher: false };
      }

      return { ok: true, mode: "trigger" as const, watcher: true };
    } catch (err: any) {
      // Fallback para instalações fora de container (Node direto na VPS):
      // tenta achar e rodar deploy.sh diretamente.
      try {
        await startDeployDirectly();
        return { ok: true, mode: "spawn" as const, watcher: false };
      } catch {
        throw new Error(
          "Não foi possível iniciar a atualização. Conecte na VPS e rode uma vez: cd ~/app && bash deploy.sh",
        );
      }
    }
  });
