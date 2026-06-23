ALTER TABLE public.odds
  ADD CONSTRAINT odds_unique_partida_casa_mercado_selecao
  UNIQUE (partida_id, casa, mercado, selecao);