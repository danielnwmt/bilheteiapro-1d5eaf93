-- Limpeza final para produção: índices de leitura e textos coerentes com o motor local.

CREATE INDEX IF NOT EXISTS idx_partidas_inicio_status
  ON public.partidas (inicio, status);

CREATE INDEX IF NOT EXISTS idx_partidas_liga_inicio
  ON public.partidas (liga, inicio);

CREATE INDEX IF NOT EXISTS idx_odds_partida_casa_mercado
  ON public.odds (partida_id, casa, mercado);

CREATE INDEX IF NOT EXISTS idx_estatisticas_partida_tipo
  ON public.estatisticas (partida_id, tipo);

CREATE INDEX IF NOT EXISTS idx_analise_cache_partida_dia
  ON public.analise_cache (partida_id, dia DESC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status_periodo
  ON public.subscriptions (status, periodo_fim);

UPDATE public.plano_config
SET descricao = CASE plano
  WHEN 'start' THEN 'Os principais campeonatos brasileiros com análises estatísticas e bilhetes inteligentes.'
  WHEN 'pro' THEN 'Acesso às principais ligas do mundo, Melhores Picks e recursos completos de gestão.'
  WHEN 'elite' THEN 'Todos os campeonatos disponíveis, recursos exclusivos e suporte prioritário.'
  ELSE descricao
END
WHERE plano IN ('start', 'pro', 'elite');

COMMENT ON TABLE public.palpites IS 'Resultados produzidos pelo motor estatístico local.';
