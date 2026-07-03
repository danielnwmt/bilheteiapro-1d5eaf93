// Limpa TODO o cache de análises (analise_cache). Usado quando há muitas odds
// desreguladas no sistema — força o robô a reanalisar tudo do zero.
// Restrito a staff (admin/operador).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const limparAnalises = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Só staff pode limpar o cache.
    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const roles = (roleRows ?? []).map((r) => r.role);
    if (!roles.includes("admin") && !roles.includes("operador")) {
      throw new Error("Apenas administradores podem limpar as análises.");
    }

    // Apaga todo o cache de análises.
    const { error } = await supabaseAdmin
      .from("analise_cache")
      .delete()
      .not("id", "is", null);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
