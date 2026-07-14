CREATE INDEX IF NOT EXISTS idx_partidas_status_inicio
  ON public.partidas (status, inicio);

CREATE INDEX IF NOT EXISTS idx_partidas_ativas_inicio
  ON public.partidas (inicio)
  WHERE status <> 'encerrado';

CREATE INDEX IF NOT EXISTS idx_odds_partida_casa_mercado
  ON public.odds (partida_id, casa, mercado);

CREATE INDEX IF NOT EXISTS idx_estatisticas_partida_tipo
  ON public.estatisticas (partida_id, tipo);

CREATE INDEX IF NOT EXISTS idx_analise_cache_partida_dia
  ON public.analise_cache (partida_id, dia DESC);