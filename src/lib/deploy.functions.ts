import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

export const deploySystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data }, { data: userData }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin.auth.admin.getUserById(userId),
    ]);
    const roles = (data ?? []).map((r: any) => r.role);
    const email = String(userData.user?.email ?? (context.claims as any)?.email ?? "").trim().toLowerCase();
    if (!roles.includes("admin") && email !== ADMIN_EMAIL) throw new Error("Apenas admin pode atualizar o sistema");

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
        // O gatilho foi gravado, mas nada vai rodá-lo: o watcher não está ativo no host.
        throw new Error(
          "O pedido foi registrado, mas o atualizador automático não está rodando na VPS. " +
            "Conecte no servidor e rode UMA vez: cd ~/app && bash deploy.sh (isso instala e liga o atualizador). " +
            "Depois o botão passa a funcionar sozinho.",
        );
      }

      return { ok: true, mode: "trigger" as const, watcher: true };
    } catch (err: any) {
      // Se já é a mensagem amigável acima, repassa.
      if (err?.message?.includes("atualizador automático")) throw err;

      // Fallback para instalações fora de container (Node direto na VPS):
      // tenta achar e rodar deploy.sh diretamente.
      try {
        const { spawn } = await import("child_process");
        const cmd =
          'DIR="$(find /opt/lovable/app /root/app /home/*/app -maxdepth 1 -name deploy.sh 2>/dev/null | head -n1 | xargs -r dirname)"; ' +
          'if [ -z "$DIR" ]; then echo "deploy.sh nao encontrado" > /tmp/deploy.log; exit 1; fi; ' +
          'cd "$DIR" && bash deploy.sh > deploy.log 2>&1';
        const child = spawn("bash", ["-lc", cmd], { detached: true, stdio: "ignore" });
        child.unref();
        return { ok: true, mode: "spawn" as const, watcher: false };
      } catch {
        throw new Error(
          "Não foi possível iniciar a atualização. Conecte na VPS e rode uma vez: cd ~/app && bash deploy.sh",
        );
      }
    }
  });
