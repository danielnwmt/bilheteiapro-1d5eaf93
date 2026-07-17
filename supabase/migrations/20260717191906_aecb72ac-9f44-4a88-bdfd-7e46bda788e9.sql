-- Corrige a API_FOOTBALL_KEY: remove os 2 caracteres extras acidentais no final (34 -> 32 chars)
UPDATE public.system_config
SET valor = 'd95a19092b7a29a86110f75102017927'
WHERE chave = 'API_FOOTBALL_KEY' AND length(valor) = 34;

-- Reseta o sync_state para que o próximo cron (em <=1min) já dispare o sync completo
DELETE FROM public.sync_state WHERE id IN ('football','football_semana','odds_diario');