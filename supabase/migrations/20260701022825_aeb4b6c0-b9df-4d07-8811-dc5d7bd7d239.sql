ALTER TABLE public.estatisticas ADD CONSTRAINT estatisticas_partida_tipo_key UNIQUE (partida_id, tipo);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estatisticas TO authenticated;
GRANT ALL ON public.estatisticas TO service_role;