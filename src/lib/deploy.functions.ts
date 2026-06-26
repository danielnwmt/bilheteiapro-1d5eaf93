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

    const { spawn } = await import("child_process");
    const cmd =
      'DIR="$(find /opt/lovable/app /root/app /home/*/app -maxdepth 1 -name deploy.sh 2>/dev/null | head -n1 | xargs -r dirname)"; ' +
      'if [ -z "$DIR" ]; then echo "deploy.sh nao encontrado" > /tmp/deploy.log; exit 1; fi; ' +
      'cd "$DIR" && bash deploy.sh > deploy.log 2>&1';
    const child = spawn("bash", ["-lc", cmd], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return { ok: true };
  });
