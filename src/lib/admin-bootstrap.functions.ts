import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

/**
 * Auto-corrige o papel de administrador.
 * Em instalações novas/self-hosted a trigger em auth.users pode não existir,
 * então o usuário admin padrão (ou o primeiro usuário do sistema) não recebe
 * o papel "admin". Esta função garante isso usando service role.
 */
export const ensureAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const email = String((claims as any)?.email ?? "").toLowerCase();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Garante perfil (caso a trigger não tenha rodado).
    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, email: email || null }, { onConflict: "id" });

    // Já é admin?
    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (existing ?? []).map((r) => r.role);
    if (roles.includes("admin")) return { isAdmin: true };

    // É o e-mail admin padrão OU ainda não existe nenhum admin no sistema?
    const { count } = await supabaseAdmin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");

    const shouldBeAdmin = email === ADMIN_EMAIL || (count ?? 0) === 0;
    if (!shouldBeAdmin) return { isAdmin: false };

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });

    return { isAdmin: true };
  });
