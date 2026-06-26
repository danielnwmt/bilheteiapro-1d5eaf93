import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

const RecursosSchema = z.record(z.string(), z.boolean());

const planoKey = z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, "Use apenas letras minúsculas, números, - ou _");

const UpdateSchema = z.object({
  plano: planoKey,
  nome: z.string().min(1).max(120),
  preco: z.string().min(1).max(40),
  descricao: z.string().min(1).max(400),
  historicoDias: z.number().int().min(1).max(365),
  ligas: z.array(z.string()).max(100),
  recursos: RecursosSchema,
});

const CreateSchema = z.object({
  plano: planoKey,
  nome: z.string().min(1).max(120),
  preco: z.string().min(1).max(40),
  descricao: z.string().max(400).optional(),
  historicoDias: z.number().int().min(1).max(365).optional(),
  ligas: z.array(z.string()).max(100).optional(),
  recursos: RecursosSchema.optional(),
});

async function assertAdmin(userId: string, claims: unknown) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: roles }, { data: userData }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId),
    supabaseAdmin.auth.admin.getUserById(userId),
  ]);
  const email = String(userData.user?.email ?? (claims as any)?.email ?? "").trim().toLowerCase();
  if (!(roles ?? []).some((r) => r.role === "admin") && email !== ADMIN_EMAIL) {
    throw new Error("Acesso restrito a administradores.");
  }
  return supabaseAdmin;
}

export const updatePlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context.userId, context.claims);
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

export const createPlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context.userId, context.claims);

    const { data: existing } = await supabaseAdmin
      .from("plano_config")
      .select("plano")
      .eq("plano", data.plano)
      .maybeSingle();
    if (existing) throw new Error("Já existe um plano com esse identificador.");

    const { data: maxRow } = await supabaseAdmin
      .from("plano_config")
      .select("nivel")
      .order("nivel", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nivel = (maxRow?.nivel ?? 0) + 1;

    const { error } = await supabaseAdmin.from("plano_config").insert({
      plano: data.plano,
      nome: data.nome,
      preco: data.preco,
      descricao: data.descricao ?? "",
      nivel,
      price_id: "",
      historico_dias: data.historicoDias ?? 15,
      ligas: data.ligas ?? [],
      recursos: data.recursos ?? {},
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePlanoConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ plano: planoKey }).parse(d))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await assertAdmin(context.userId, context.claims);
    const { error } = await supabaseAdmin.from("plano_config").delete().eq("plano", data.plano);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
