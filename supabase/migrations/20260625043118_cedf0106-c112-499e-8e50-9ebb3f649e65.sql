CREATE TABLE public.plano_config (
  plano public.plano_tipo PRIMARY KEY,
  nome text NOT NULL,
  preco text NOT NULL,
  descricao text NOT NULL,
  nivel integer NOT NULL,
  price_id text NOT NULL,
  historico_dias integer NOT NULL DEFAULT 15,
  ligas jsonb NOT NULL DEFAULT '[]'::jsonb,
  recursos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plano_config TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.plano_config TO authenticated;
GRANT ALL ON public.plano_config TO service_role;

ALTER TABLE public.plano_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos veem config de planos" ON public.plano_config
  FOR SELECT USING (true);

CREATE POLICY "Admin edita config de planos" ON public.plano_config
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_plano_config_updated_at
  BEFORE UPDATE ON public.plano_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed com os valores atuais
INSERT INTO public.plano_config (plano, nome, preco, descricao, nivel, price_id, historico_dias, ligas, recursos) VALUES
(
  'start', 'BilheteIA Start', 'R$ 29,90', 'Para quem busca múltiplas inteligentes com IA.', 1, 'start_monthly', 15,
  '["Brasileirão Série A","Brasileirão Série B","Premier League"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":false,"favoritos":false,"estatisticasAvancadas":false,"tempoReal":false,"alertasInteligentes":false,"suportePrioritario":false}'::jsonb
),
(
  'pro', 'BilheteIA Pro', 'R$ 49,90', 'Todas as ligas mundiais e ferramentas de gestão.', 2, 'pro_monthly', 30,
  '["Brasileirão Série A","Brasileirão Série B","Premier League","Copa do Brasil","Libertadores","Sul-Americana","La Liga","Serie A (Itália)","Bundesliga","Ligue 1","Champions League","Europa League","Conference League","Copa do Mundo"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":true,"favoritos":true,"estatisticasAvancadas":true,"tempoReal":false,"alertasInteligentes":false,"suportePrioritario":false}'::jsonb
),
(
  'elite', 'BilheteIA Elite', 'R$ 79,90', 'Tudo, em tempo real e com suporte prioritário.', 3, 'elite_monthly', 60,
  '["Brasileirão Série A","Brasileirão Série B","Premier League","Copa do Brasil","Libertadores","Sul-Americana","La Liga","Serie A (Itália)","Bundesliga","Ligue 1","Champions League","Europa League","Conference League","Copa do Mundo"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":true,"favoritos":true,"estatisticasAvancadas":true,"tempoReal":true,"alertasInteligentes":true,"suportePrioritario":true}'::jsonb
);