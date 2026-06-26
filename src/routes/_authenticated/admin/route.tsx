import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureAdmin } from "@/lib/admin-bootstrap.functions";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw redirect({ to: "/auth" });
    const isDefaultAdmin = String(userData.user?.email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    const list = (roles ?? []).map((r) => r.role);
    let isAdmin = list.includes("admin") || isDefaultAdmin;
    if (!list.includes("admin")) {
      try {
        const fixed = await ensureAdmin();
        isAdmin = isAdmin || !!fixed.isAdmin;
      } catch {
        // sem reparo: segue o bloqueio normal
      }
    }
    if (!isAdmin) throw redirect({ to: "/" });
    return { isAdmin };
  },
  component: () => <Outlet />,
});
