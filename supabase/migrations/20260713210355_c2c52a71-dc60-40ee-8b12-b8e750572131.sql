-- Corrige acesso à tabela de configuração de planos.
-- Causa raiz do "permission denied for table plano_config": a tabela não tinha
-- nenhum GRANT para os papéis do Data API, então a leitura era negada mesmo com
-- a policy de SELECT liberada. Também removemos coluna legada price_id, que
-- quebrava SELECT * quando presente com grants por coluna.

ALTER TABLE public.plano_config DROP COLUMN IF EXISTS price_id;

GRANT SELECT ON public.plano_config TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.plano_config TO authenticated;
GRANT ALL ON public.plano_config TO service_role;

-- Garante que a feature "Melhores Picks" fique liberada para Pro e Elite
-- (planos que já a anunciam), caso alguma linha não tenha a chave no JSONB.
UPDATE public.plano_config
SET recursos = COALESCE(recursos, '{}'::jsonb) || '{"melhoresPicks": true}'::jsonb
WHERE plano IN ('pro', 'elite')
  AND COALESCE((recursos->>'melhoresPicks')::boolean, false) = false;

NOTIFY pgrst, 'reload schema';