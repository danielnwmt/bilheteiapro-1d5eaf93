import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ADMIN_EMAIL = "contato@protenexus.com";

export type StatusConversa =
  | "aberto"
  | "aguardando_atendente"
  | "em_atendimento"
  | "aguardando_cliente"
  | "finalizado";

export type ConversaStaff = {
  id: string;
  userId: string;
  atendenteId: string | null;
  atendenteNome: string | null;
  status: StatusConversa;
  tags: string[];
  assunto: string | null;
  criadoEm: string;
  atualizadoEm: string;
  finalizadoEm: string | null;
  nome: string;
  email: string;
  telefone: string;
  ultimaMensagem: string;
  ultimaEm: string;
  naoLidas: number;
};

export type MensagemStaff = {
  id: string;
  autor: string;
  autorNome: string | null;
  conteudo: string;
  tipo: string;
  arquivoUrl: string | null;
  arquivoNome: string | null;
  lida: boolean;
  created_at: string;
};

export type DashboardSuporte = {
  hoje: number;
  ativos: number;
  aguardando: number;
  finalizados: number;
  tempoRespostaMin: number;
  tempoAtendimentoMin: number;
  reclamacoesAbertas: number;
  reclamacoesResolvidas: number;
  avaliacaoMedia: number;
};

type Ctx = { supabase: any; userId: string; claims: unknown };

function emailFromClaims(claims: unknown): string {
  const c = claims as any;
  return String(c?.email ?? c?.user_metadata?.email ?? "").trim().toLowerCase();
}

// Descobre os papéis do usuário atual (RLS deixa o próprio ver seus papéis).
async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  const roles = (data ?? []).map((r: any) => String(r.role));
  if (emailFromClaims(ctx.claims) === ADMIN_EMAIL && !roles.includes("admin")) roles.push("admin");
  return roles;
}

function scope(roles: string[]) {
  const isAdmin = roles.includes("admin");
  const isGestor = isAdmin || roles.includes("supervisor");
  const isOperador = roles.includes("operador");
  return { isAdmin, isGestor, isOperador, isStaff: isGestor || isOperador };
}

async function assertStaff(ctx: Ctx) {
  const roles = await getRoles(ctx);
  const s = scope(roles);
  if (!s.isStaff) throw new Error("Acesso restrito");
  return s;
}

async function assertAdmin(ctx: Ctx) {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin")) throw new Error("Acesso restrito");
}

// ============ Lista de conversas para o console de atendimento ============
export const listConversasStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    const s = await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("suporte_conversas")
      .select("*")
      .order("atualizado_em", { ascending: false });

    // Atendente puro vê apenas as suas e a fila (sem atendente).
    if (!s.isGestor && s.isOperador) {
      q = q.or(`atendente_id.eq.${ctx.userId},atendente_id.is.null`);
    }

    const { data: convs } = await q;
    const rows = (convs ?? []) as any[];
    if (rows.length === 0) return [] as ConversaStaff[];

    const ids = rows.map((c) => c.id);
    const userIds = [...new Set(rows.map((c) => c.user_id))];

    const { data: msgs } = await supabaseAdmin
      .from("suporte_mensagens")
      .select("conversa_id, conteudo, autor, tipo, lida, created_at")
      .in("conversa_id", ids)
      .order("created_at", { ascending: true });

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, nome, email, telefone")
      .in("id", userIds);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));

    const lastMap = new Map<string, { conteudo: string; created_at: string }>();
    const unreadMap = new Map<string, number>();
    for (const m of (msgs ?? []) as any[]) {
      const label = m.tipo === "arquivo" ? "📎 Anexo" : m.conteudo;
      lastMap.set(m.conversa_id, { conteudo: label, created_at: m.created_at });
      if (m.autor === "cliente" && !m.lida) {
        unreadMap.set(m.conversa_id, (unreadMap.get(m.conversa_id) ?? 0) + 1);
      }
    }

    return rows.map((c) => {
      const p = profMap.get(c.user_id) as any;
      const last = lastMap.get(c.id);
      return {
        id: c.id,
        userId: c.user_id,
        atendenteId: c.atendente_id,
        atendenteNome: c.atendente_nome,
        status: c.status,
        tags: c.tags ?? [],
        assunto: c.assunto,
        criadoEm: c.criado_em,
        atualizadoEm: c.atualizado_em,
        finalizadoEm: c.finalizado_em,
        nome: p?.nome ?? "",
        email: p?.email ?? "",
        telefone: p?.telefone ?? "",
        ultimaMensagem: last?.conteudo ?? "",
        ultimaEm: last?.created_at ?? c.criado_em,
        naoLidas: unreadMap.get(c.id) ?? 0,
      } as ConversaStaff;
    });
  });

// ============ Mensagens de uma conversa ============
export const getConversaStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversaId: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: msgs } = await supabaseAdmin
      .from("suporte_mensagens")
      .select("id, autor, autor_nome, conteudo, tipo, arquivo_url, arquivo_nome, lida, created_at")
      .eq("conversa_id", data.conversaId)
      .order("created_at", { ascending: true });

    // Marca mensagens do cliente como lidas.
    await supabaseAdmin
      .from("suporte_mensagens")
      .update({ lida: true })
      .eq("conversa_id", data.conversaId)
      .eq("autor", "cliente")
      .eq("lida", false);

    return ((msgs ?? []) as any[]).map((m) => ({
      id: m.id,
      autor: m.autor,
      autorNome: m.autor_nome,
      conteudo: m.conteudo,
      tipo: m.tipo,
      arquivoUrl: m.arquivo_url,
      arquivoNome: m.arquivo_nome,
      lida: m.lida,
      created_at: m.created_at,
    })) as MensagemStaff[];
  });

// ============ Assumir atendimento ============
export const assumirConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversaId: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const s = await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conv } = await supabaseAdmin
      .from("suporte_conversas")
      .select("atendente_id")
      .eq("id", data.conversaId)
      .maybeSingle();
    if (conv && (conv as any).atendente_id && (conv as any).atendente_id !== ctx.userId && !s.isGestor) {
      throw new Error("Conversa já assumida por outro atendente");
    }

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("nome, email")
      .eq("id", ctx.userId)
      .maybeSingle();
    const nome = (prof as any)?.nome || (prof as any)?.email || "Atendente";

    await supabaseAdmin
      .from("suporte_conversas")
      .update({ atendente_id: ctx.userId, atendente_nome: nome, status: "em_atendimento" })
      .eq("id", data.conversaId);

    await supabaseAdmin.from("chatbot_logs").insert({
      user_id: ctx.userId,
      conversa_id: data.conversaId,
      evento: "atendente_assumiu",
      detalhes: { atendente: nome },
    });
    return { ok: true, atendenteNome: nome };
  });

// ============ Alterar status ============
export const setStatusConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversaId: string; status: StatusConversa }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.status === "finalizado") patch.finalizado_em = new Date().toISOString();
    await supabaseAdmin.from("suporte_conversas").update(patch).eq("id", data.conversaId);
    await supabaseAdmin.from("chatbot_logs").insert({
      user_id: ctx.userId,
      conversa_id: data.conversaId,
      evento: "status_alterado",
      detalhes: { status: data.status },
    });
    return { ok: true };
  });

// ============ Etiquetas ============
export const setTagsConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversaId: string; tags: string[] }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("suporte_conversas")
      .update({ tags: data.tags.slice(0, 20) })
      .eq("id", data.conversaId);
    return { ok: true };
  });

// ============ Enviar mensagem (atendente) ============
export const enviarMensagemStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    conversaId: string;
    userId: string;
    conteudo: string;
    tipo?: string;
    arquivoUrl?: string;
    arquivoNome?: string;
  }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("nome, email")
      .eq("id", ctx.userId)
      .maybeSingle();
    const nome = (prof as any)?.nome || (prof as any)?.email || "Atendente";

    const { error } = await supabaseAdmin.from("suporte_mensagens").insert({
      user_id: data.userId,
      conversa_id: data.conversaId,
      autor: "suporte",
      autor_nome: nome,
      conteudo: data.conteudo,
      tipo: data.tipo ?? "texto",
      arquivo_url: data.arquivoUrl ?? null,
      arquivo_nome: data.arquivoNome ?? null,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("suporte_conversas")
      .update({ status: "em_atendimento", atualizado_em: new Date().toISOString() })
      .eq("id", data.conversaId);
    return { ok: true };
  });

// ============ Finalizar ============
export const finalizarConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversaId: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("suporte_conversas")
      .update({ status: "finalizado", finalizado_em: new Date().toISOString() })
      .eq("id", data.conversaId);
    await supabaseAdmin.from("chatbot_logs").insert({
      user_id: ctx.userId,
      conversa_id: data.conversaId,
      evento: "conversa_encerrada",
      detalhes: {},
    });
    return { ok: true };
  });

// ============ Dashboard ============
export const getDashboardSuporte = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: convs } = await supabaseAdmin
      .from("suporte_conversas")
      .select("id, status, criado_em, finalizado_em");
    const { data: msgs } = await supabaseAdmin
      .from("suporte_mensagens")
      .select("conversa_id, autor, created_at")
      .order("created_at", { ascending: true });
    const { data: recl } = await supabaseAdmin.from("reclamacoes").select("status, arquivada");
    const { data: avals } = await supabaseAdmin.from("avaliacoes").select("nota");

    const cRows = (convs ?? []) as any[];
    const hojeStr = new Date().toISOString().slice(0, 10);

    const hoje = cRows.filter((c) => String(c.criado_em).slice(0, 10) === hojeStr).length;
    const ativos = cRows.filter((c) => c.status === "em_atendimento").length;
    const aguardando = cRows.filter(
      (c) => c.status === "aberto" || c.status === "aguardando_atendente",
    ).length;
    const finalizados = cRows.filter((c) => c.status === "finalizado").length;

    // Tempo médio de resposta (1ª mensagem cliente → 1ª resposta suporte).
    const porConv = new Map<string, any[]>();
    for (const m of (msgs ?? []) as any[]) {
      const arr = porConv.get(m.conversa_id) ?? [];
      arr.push(m);
      porConv.set(m.conversa_id, arr);
    }
    let somaResp = 0;
    let qtdResp = 0;
    for (const arr of porConv.values()) {
      let pend: string | null = null;
      for (const m of arr) {
        if (m.autor === "cliente") {
          if (!pend) pend = m.created_at;
        } else if (m.autor === "suporte" && pend) {
          const min = (new Date(m.created_at).getTime() - new Date(pend).getTime()) / 60000;
          if (min >= 0) {
            somaResp += min;
            qtdResp += 1;
          }
          pend = null;
        }
      }
    }

    let somaAtend = 0;
    let qtdAtend = 0;
    for (const c of cRows) {
      if (c.finalizado_em) {
        const min = (new Date(c.finalizado_em).getTime() - new Date(c.criado_em).getTime()) / 60000;
        if (min >= 0) {
          somaAtend += min;
          qtdAtend += 1;
        }
      }
    }

    const reclArr = (recl ?? []) as any[];
    const reclamacoesResolvidas = reclArr.filter((r) => r.status === "resolvida").length;
    const reclamacoesAbertas = reclArr.filter((r) => r.status !== "resolvida" && !r.arquivada).length;

    const avalArr = (avals ?? []) as any[];
    const avaliacaoMedia = avalArr.length
      ? Math.round((avalArr.reduce((a, b) => a + Number(b.nota), 0) / avalArr.length) * 10) / 10
      : 0;

    return {
      hoje,
      ativos,
      aguardando,
      finalizados,
      tempoRespostaMin: qtdResp ? Math.round(somaResp / qtdResp) : 0,
      tempoAtendimentoMin: qtdAtend ? Math.round(somaAtend / qtdAtend) : 0,
      reclamacoesAbertas,
      reclamacoesResolvidas,
      avaliacaoMedia,
    } as DashboardSuporte;
  });

// ============ Respostas rápidas ============
export type RespostaRapida = { id: string; atalho: string; texto: string };

export const listRespostasRapidas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    await assertStaff(ctx);
    const { data } = await ctx.supabase
      .from("respostas_rapidas")
      .select("id, atalho, texto")
      .order("atalho", { ascending: true });
    return (data ?? []) as RespostaRapida[];
  });

export const salvarRespostaRapida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; atalho: string; texto: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const atalho = data.atalho.trim().replace(/^\/+/, "");
    if (!atalho || !data.texto.trim()) throw new Error("Preencha atalho e texto");
    if (data.id) {
      await supabaseAdmin
        .from("respostas_rapidas")
        .update({ atalho, texto: data.texto.trim() })
        .eq("id", data.id);
    } else {
      await supabaseAdmin.from("respostas_rapidas").insert({ atalho, texto: data.texto.trim() });
    }
    return { ok: true };
  });

export const removerRespostaRapida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("respostas_rapidas").delete().eq("id", data.id);
    return { ok: true };
  });

// ============ Configuração de horário ============
export type SuporteConfig = {
  dias: Record<string, { ativo: boolean; inicio: string; fim: string }>;
  mensagemOffline: string;
};

export const getSuporteConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as Ctx;
    const { data } = await ctx.supabase
      .from("suporte_config")
      .select("dias, mensagem_offline")
      .eq("id", true)
      .maybeSingle();
    return {
      dias: ((data as any)?.dias ?? {}) as SuporteConfig["dias"],
      mensagemOffline:
        (data as any)?.mensagem_offline ??
        "Nosso suporte está offline. Responderemos assim que possível.",
    } as SuporteConfig;
  });

export const setSuporteConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SuporteConfig) => d)
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("suporte_config")
      .update({ dias: data.dias, mensagem_offline: data.mensagemOffline })
      .eq("id", true);
    return { ok: true };
  });
