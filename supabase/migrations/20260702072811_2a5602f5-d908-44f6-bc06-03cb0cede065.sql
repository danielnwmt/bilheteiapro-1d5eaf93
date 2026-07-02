CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.limpar_dados_antigos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  -- Análises de dias anteriores (mantém apenas o dia atual).
  DELETE FROM public.analise_cache WHERE dia < hoje;

  -- Estatísticas com mais de 2 dias.
  DELETE FROM public.estatisticas WHERE created_at < now() - INTERVAL '2 days';

  -- Odds de partidas já encerradas (cotações não servem mais).
  DELETE FROM public.odds o
  USING public.partidas p
  WHERE o.partida_id = p.id AND p.status = 'encerrado';
END;
$$;

-- Agenda diária às 5h (America/Sao_Paulo = 08:00 UTC).
SELECT cron.schedule(
  'limpar-dados-antigos',
  '0 8 * * *',
  $$ SELECT public.limpar_dados_antigos(); $$
);