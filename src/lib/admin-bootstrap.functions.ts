import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";
const ADMIN_PASSWORD = "admin.1234";

export const bootstrapDefaultAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string }) => {
    const email = String(input?.email ?? "").trim().toLowerCase();
    const password = String(input?.password ?? "");
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      throw new Error("Credenciais do administrador padrão inválidas.");
    }
    return { email, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count: adminCount } = await supabaseAdmin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");

    const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw new Error(listError.message);

    let user = listed.users.find((u) => String(u.email ?? "").toLowerCase() === ADMIN_EMAIL);

    if ((adminCount ?? 0) > 0 && user) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if ((roles ?? []).some((r) => r.role === "admin")) return { ok: true, created: false };
    }

    if (!user) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: data.password,
        email_confirm: true,
        user_metadata: { nome: "Administrador" },
      });
      if (error) throw new Error(error.message);
      if (!created.user) throw new Error("Não foi possível criar o administrador padrão.");
      user = created.user;
    } else if ((adminCount ?? 0) === 0) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: data.password,
        user_metadata: { ...(user.user_metadata ?? {}), nome: user.user_metadata?.nome ?? "Administrador" },
      });
      if (error) throw new Error(error.message);
    } else {
      return { ok: false, created: false };
    }

    await supabaseAdmin.from("profiles").upsert(
      {
        id: user.id,
        nome: "Administrador",
        email: ADMIN_EMAIL,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", user.id).eq("role", "cliente");

    return { ok: true, created: true };
  });

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
    if (email === ADMIN_EMAIL) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "cliente");
    }

    return { isAdmin: true };
  });
