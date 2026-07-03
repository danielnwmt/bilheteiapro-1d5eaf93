import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SuporteConversa = {
  userId: string;
  nome: string;
  email: string;
  ultimaMensagem: string;
  ultimaEm: string;
  naoLidas: number;
};

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Acesso restrito");
}

// Lista as conversas de suporte (uma por cliente) para o painel admin.
export const listSuporteConversas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msgs } = await supabaseAdmin
      .from("suporte_mensagens")
      .select("user_id, conteudo, autor, lida, created_at")
      .order("created_at", { ascending: true });

    const rows = (msgs ?? []) as Array<{
      user_id: string;
      conteudo: string;
      autor: string;
      lida: boolean;
      created_at: string;
    }>;

    const porUser = new Map<string, SuporteConversa>();
    for (const m of rows) {
      const atual = porUser.get(m.user_id) ?? {
        userId: m.user_id,
        nome: "",
        email: "",
        ultimaMensagem: "",
        ultimaEm: "",
        naoLidas: 0,
      };
      atual.ultimaMensagem = m.conteudo;
      atual.ultimaEm = m.created_at;
      if (m.autor === "cliente" && !m.lida) atual.naoLidas += 1;
      porUser.set(m.user_id, atual);
    }

    const ids = [...porUser.keys()];
    if (ids.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, nome, email")
        .in("id", ids);
      for (const p of profs ?? []) {
        const c = porUser.get((p as any).id);
        if (c) {
          c.nome = (p as any).nome ?? "";
          c.email = (p as any).email ?? "";
        }
      }
    }

    return [...porUser.values()].sort((a, b) => (a.ultimaEm < b.ultimaEm ? 1 : -1));
  });
