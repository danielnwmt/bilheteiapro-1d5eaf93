-- ===== Partidas =====
CREATE TABLE public.partidas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id text UNIQUE,
  liga text,
  time_casa text NOT NULL,
  time_fora text NOT NULL,
  inicio timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partidas TO anon, authenticated;
GRANT ALL ON public.partidas TO service_role;
ALTER TABLE public.partidas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partidas sao publicas" ON public.partidas FOR SELECT USING (true);

-- ===== Estatisticas historicas =====
CREATE TABLE public.estatisticas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  tipo text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.estatisticas TO anon, authenticated;
GRANT ALL ON public.estatisticas TO service_role;
ALTER TABLE public.estatisticas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estatisticas sao publicas" ON public.estatisticas FOR SELECT USING (true);

-- ===== Odds =====
CREATE TABLE public.odds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  casa text NOT NULL,
  mercado text NOT NULL,
  selecao text NOT NULL,
  valor numeric NOT NULL,
  external_odd_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.odds TO anon, authenticated;
GRANT ALL ON public.odds TO service_role;
ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Odds sao publicas" ON public.odds FOR SELECT USING (true);
CREATE INDEX idx_odds_partida ON public.odds(partida_id);

-- ===== Deep links (tabela de traducao) =====
CREATE TABLE public.deep_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  casa text NOT NULL,
  mercado text,
  url_template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deep_links TO anon, authenticated;
GRANT ALL ON public.deep_links TO service_role;
ALTER TABLE public.deep_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deep links sao publicos" ON public.deep_links FOR SELECT USING (true);

-- ===== Palpites (resultado da IA) =====
CREATE TABLE public.palpites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  mercado text NOT NULL,
  selecao text NOT NULL,
  odd numeric NOT NULL,
  confianca numeric NOT NULL,
  justificativa text,
  deep_link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.palpites TO anon, authenticated;
GRANT ALL ON public.palpites TO service_role;
ALTER TABLE public.palpites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Palpites sao publicos" ON public.palpites FOR SELECT USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_partidas_updated BEFORE UPDATE ON public.partidas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_odds_updated BEFORE UPDATE ON public.odds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_deep_links_updated BEFORE UPDATE ON public.deep_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed deep link templates (placeholders {jogo} {selecao} {odd_id})
INSERT INTO public.deep_links (casa, mercado, url_template) VALUES
  ('Betano', NULL, 'https://www.betano.bet.br/search/?query={jogo}'),
  ('Bet365', NULL, 'https://www.google.com/search?q=bet365%20{jogo}'),
  ('Superbet', NULL, 'https://superbet.bet.br/search?query={jogo}');