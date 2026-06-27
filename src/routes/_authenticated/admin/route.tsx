import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccess } from "@/lib/access.functions";

const ADMIN_EMAIL = "contato@protenexus.com";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) throw redirect({ to: "/auth" });

    const isDefaultAdmin =
      String(user.email ?? "").trim().toLowerCase() === ADMIN_EMAIL;

    // O admin geral não precisa esperar consulta extra ao servidor para abrir o painel.
    if (isDefaultAdmin) return { isAdmin: true };

    // Fonte única de verdade: getMyAccess já faz o auto-reparo do admin padrão.
    try {
      const access = await getMyAccess();
      if (!access.isAdmin && !isDefaultAdmin) throw redirect({ to: "/" });
      return { isAdmin: true };
    } catch (err) {
      if (err && typeof err === "object" && "to" in (err as any)) throw err;
      // Self-host: se a checagem do servidor falhar, o admin padrão ainda entra.
      if (isDefaultAdmin) return { isAdmin: true };
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
});

