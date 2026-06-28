CREATE TABLE public.analise_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid NOT NULL REFERENCES public.partidas(id) ON DELETE CASCADE,
  dia date NOT NULL,
  casa text NOT NULL DEFAULT 'Betano',
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (partida_id, dia, casa)
);

GRANT SELECT ON public.analise_cache TO authenticated;
GRANT ALL ON public.analise_cache TO service_role;

ALTER TABLE public.analise_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados podem ler analises"
ON public.analise_cache FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_analise_cache_dia ON public.analise_cache (dia, casa);