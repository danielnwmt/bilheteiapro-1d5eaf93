import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

const RecursosSchema = z.record(z.string(), z.boolean());

const UpdateSchema = z.object({
  plano: z.enum(["start", "pro", "elite"]),
  nome: z.string().min(1).max(120),
  preco: z.string().min(1).max(40),
  descricao: z.string().min(1).max(400),
  historicoDias: z.number().int().min(1).max(365),
  ligas: z.array(z.string()).max(100),
  recursos: RecursosSchema,
});

export const updatePlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: roles }, { data: userData }] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
      supabaseAdmin.auth.admin.getUserById(userId),
    ]);
    const email = String(userData.user?.email ?? (context.claims as any)?.email ?? "").trim().toLowerCase();
    if (!(roles ?? []).some((r) => r.role === "admin") && email !== ADMIN_EMAIL) {
      throw new Error("Acesso restrito a administradores.");
    }

    const { error } = await supabaseAdmin
      .from("plano_config")
      .update({
        nome: data.nome,
        preco: data.preco,
        descricao: data.descricao,
        historico_dias: data.historicoDias,
        ligas: data.ligas,
        recursos: data.recursos,
      })
      .eq("plano", data.plano);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
