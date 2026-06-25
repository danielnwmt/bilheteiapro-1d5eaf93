import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureAdmin } from "@/lib/admin-bootstrap.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid);
    const list = (roles ?? []).map((r) => r.role);
    let isStaff = list.includes("admin") || list.includes("operador");
    let isAdmin = list.includes("admin");
    if (!isStaff) {
      try {
        const fixed = await ensureAdmin();
        isAdmin = !!fixed.isAdmin;
        isStaff = isAdmin;
      } catch {
        // sem reparo: segue o bloqueio normal
      }
    }
    if (!isStaff) throw redirect({ to: "/" });
    return { isAdmin };
  },
  component: () => <Outlet />,
});
