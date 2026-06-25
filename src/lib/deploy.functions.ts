import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deploySystem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (data ?? []).map((r: any) => r.role);
    if (!roles.includes("admin")) throw new Error("Apenas admin pode atualizar o sistema");

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
