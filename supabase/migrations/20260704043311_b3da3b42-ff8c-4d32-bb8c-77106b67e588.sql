-- =====================================================================
-- HISTÓRICO DE BILHETES
-- Registro persistente de cada bilhete do usuário (green/red/void/pendente).
-- =====================================================================
CREATE TABLE public.historico_bilhetes (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_evento   date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  jogos         text NOT NULL DEFAULT '',
  mercados      text NOT NULL DEFAULT '',
  odds_detalhe  jsonb NOT NULL DEFAULT '[]'::jsonb, -- picks: [{jogo, mercado, selecao, odd}]
  odd_total     numeric(10,2) NOT NULL DEFAULT 1,
  tipo          text NOT NULL DEFAULT 'padrao',
  casa          text,
  stake         numeric(12,2) NOT NULL DEFAULT 0,
  retorno       numeric(12,2) NOT NULL DEFAULT 0,
  resultado     text NOT NULL DEFAULT 'pendente', -- pendente | green | red | void
  observacoes   text,
  bilhete_id    uuid REFERENCES public.bilhetes(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_historico_bilhetes_user ON public.historico_bilhetes (user_id, data_evento DESC);
CREATE INDEX idx_historico_bilhetes_resultado ON public.historico_bilhetes (user_id, resultado);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.historico_bilhetes TO authenticated;
GRANT ALL ON public.historico_bilhetes TO service_role;

ALTER TABLE public.historico_bilhetes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios gerenciam seu historico"
  ON public.historico_bilhetes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_historico_bilhetes_updated_at
  BEFORE UPDATE ON public.historico_bilhetes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- FAVORITOS
-- Campeonatos, jogos, mercados, times e bilhetes marcados pelo usuário.
-- =====================================================================
CREATE TABLE public.favoritos (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo       text NOT NULL, -- campeonato | jogo | mercado | time | bilhete
  valor      text NOT NULL, -- identificador/nome do item favoritado
  rotulo     text,          -- rótulo amigável para exibição
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tipo, valor)
);

CREATE INDEX idx_favoritos_user ON public.favoritos (user_id, tipo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.favoritos TO authenticated;
GRANT ALL ON public.favoritos TO service_role;

ALTER TABLE public.favoritos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios gerenciam seus favoritos"
  ON public.favoritos FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);