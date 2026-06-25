import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

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
    const isStaff = list.includes("admin") || list.includes("operador");
    if (!isStaff) throw redirect({ to: "/" });
    return { isAdmin: list.includes("admin") };
  },
  component: () => <Outlet />,
});
