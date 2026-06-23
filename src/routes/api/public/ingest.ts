import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const OddSchema = z.object({
  casa: z.string(),
  mercado: z.string(),
  selecao: z.string(),
  valor: z.number(),
  external_odd_id: z.string().optional(),
});

const EstatisticaSchema = z.object({
  tipo: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

const PartidaSchema = z.object({
  external_id: z.string(),
  liga: z.string().optional(),
  time_casa: z.string(),
  time_fora: z.string(),
  inicio: z.string(),
  status: z.string().optional().default("agendado"),
  odds: z.array(OddSchema).optional().default([]),
  estatisticas: z.array(EstatisticaSchema).optional().default([]),
});

const BodySchema = z.object({
  partidas: z.array(PartidaSchema).min(1).max(2000),
});

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.INGEST_SECRET;
        const provided = request.headers.get("x-ingest-secret");
        if (!secret || provided !== secret) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (err) {
          return new Response(
            JSON.stringify({ error: "Payload inválido", detail: String(err) }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let partidasUpsert = 0;
        let oddsUpsert = 0;
        let statsUpsert = 0;

        for (const p of body.partidas) {
          const { data: partida, error: pErr } = await supabaseAdmin
            .from("partidas")
            .upsert(
              {
                external_id: p.external_id,
                liga: p.liga ?? null,
                time_casa: p.time_casa,
                time_fora: p.time_fora,
                inicio: p.inicio,
                status: p.status,
              },
              { onConflict: "external_id" },
            )
            .select("id")
            .single();

          if (pErr || !partida) {
            console.error("Erro ao gravar partida", p.external_id, pErr);
            continue;
          }
          partidasUpsert += 1;

          // Substitui odds e estatísticas da partida pelos dados mais recentes
          await supabaseAdmin.from("odds").delete().eq("partida_id", partida.id);
          await supabaseAdmin.from("estatisticas").delete().eq("partida_id", partida.id);

          if (p.odds.length) {
            const { error: oErr } = await supabaseAdmin.from("odds").insert(
              p.odds.map((o) => ({ ...o, partida_id: partida.id })),
            );
            if (oErr) console.error("Erro odds", p.external_id, oErr);
            else oddsUpsert += p.odds.length;
          }

          if (p.estatisticas.length) {
            const { error: eErr } = await supabaseAdmin.from("estatisticas").insert(
              p.estatisticas.map((s) => ({
                tipo: s.tipo ?? null,
                payload: s.payload,
                partida_id: partida.id,
              })),
            );
            if (eErr) console.error("Erro estatisticas", p.external_id, eErr);
            else statsUpsert += p.estatisticas.length;
          }
        }

        return new Response(
          JSON.stringify({
            ok: true,
            partidas: partidasUpsert,
            odds: oddsUpsert,
            estatisticas: statsUpsert,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
