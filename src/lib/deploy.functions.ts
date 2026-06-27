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

    try {
      await fs.mkdir(path.dirname(triggerFile), { recursive: true });
      await fs.writeFile(triggerFile, `${Date.now()}\n`, "utf8");
      return { ok: true, mode: "trigger" as const };
    } catch (err) {
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
        return { ok: true, mode: "spawn" as const };
      } catch {
        throw new Error(
          "Não foi possível iniciar a atualização. Verifique se o watcher de atualização está ativo na VPS (rode 'bash deploy.sh' uma vez para instalar).",
        );
      }
    }
  });
