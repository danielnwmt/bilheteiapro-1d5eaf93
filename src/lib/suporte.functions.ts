import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SuporteConversa = {
  userId: string;
  nome: string;
  email: string;
  ultimaMensagem: string;
  ultimaEm: string;
  naoLidas: number;
  encerrada: boolean;
};

export type SuporteMetricas = {
  finalizados: number;
  abertos: number;
  tempoMedioMin: number;
  serie: Array<{ dia: string; finalizados: number; tempoEsperaMin: number }>;
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
        encerrada: false,
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

      const { data: status } = await supabaseAdmin
        .from("suporte_status")
        .select("user_id, encerrada")
        .in("user_id", ids);
      for (const s of status ?? []) {
        const c = porUser.get((s as any).user_id);
        if (c) c.encerrada = !!(s as any).encerrada;
      }
    }

    return [...porUser.values()].sort((a, b) => (a.ultimaEm < b.ultimaEm ? 1 : -1));
  });

// Métricas: chamados finalizados e tempo médio de resposta ao cliente.
export const getSuporteMetricas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: msgs } = await supabaseAdmin
      .from("suporte_mensagens")
      .select("user_id, autor, created_at")
      .order("created_at", { ascending: true });

    const { data: status } = await supabaseAdmin
      .from("suporte_status")
      .select("user_id, encerrada, encerrada_em");

    const rows = (msgs ?? []) as Array<{ user_id: string; autor: string; created_at: string }>;

    // Últimos 7 dias.
    const dias: string[] = [];
    const hoje = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(hoje.getDate() - i);
      dias.push(d.toISOString().slice(0, 10));
    }
    const serieMap = new Map<string, { finalizados: number; somaEspera: number; qtdEspera: number }>();
    for (const d of dias) serieMap.set(d, { finalizados: 0, somaEspera: 0, qtdEspera: 0 });

    // Tempo de espera: por usuário, do 1º cliente pendente até a próxima resposta do suporte.
    const porUser = new Map<string, typeof rows>();
    for (const m of rows) {
      const arr = porUser.get(m.user_id) ?? [];
      arr.push(m);
      porUser.set(m.user_id, arr);
    }

    let somaGeral = 0;
    let qtdGeral = 0;
    for (const arr of porUser.values()) {
      let pendente: string | null = null;
      for (const m of arr) {
        if (m.autor === "cliente") {
          if (!pendente) pendente = m.created_at;
        } else if (pendente) {
          const min = (new Date(m.created_at).getTime() - new Date(pendente).getTime()) / 60000;
          if (min >= 0) {
            somaGeral += min;
            qtdGeral += 1;
            const dia = pendente.slice(0, 10);
            const s = serieMap.get(dia);
            if (s) {
              s.somaEspera += min;
              s.qtdEspera += 1;
            }
          }
          pendente = null;
        }
      }
    }

    let finalizados = 0;
    for (const s of status ?? []) {
      if ((s as any).encerrada) {
        finalizados += 1;
        const dia = String((s as any).encerrada_em ?? "").slice(0, 10);
        const item = serieMap.get(dia);
        if (item) item.finalizados += 1;
      }
    }

    const abertos = porUser.size - finalizados;

    const serie = dias.map((dia) => {
      const s = serieMap.get(dia)!;
      return {
        dia: dia.slice(5),
        finalizados: s.finalizados,
        tempoEsperaMin: s.qtdEspera ? Math.round(s.somaEspera / s.qtdEspera) : 0,
      };
    });

    return {
      finalizados,
      abertos: abertos < 0 ? 0 : abertos,
      tempoMedioMin: qtdGeral ? Math.round(somaGeral / qtdGeral) : 0,
      serie,
    } as SuporteMetricas;
  });
