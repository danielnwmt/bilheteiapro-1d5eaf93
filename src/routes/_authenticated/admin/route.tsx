import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccess } from "@/lib/access.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) throw redirect({ to: "/auth" });

    // Fonte única de verdade: getMyAccess já faz o auto-reparo do admin padrão.
    try {
      const access = await getMyAccess();
      if (!access.isAdmin) throw redirect({ to: "/" });
      return { isAdmin: true };
    } catch (err) {
      if (err && typeof err === "object" && "to" in (err as any)) throw err;
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
});
