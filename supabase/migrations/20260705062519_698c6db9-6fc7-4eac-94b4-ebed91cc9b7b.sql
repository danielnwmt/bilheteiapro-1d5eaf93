UPDATE public.plano_config
SET recursos = jsonb_set(COALESCE(recursos, '{}'::jsonb), '{oddPersonalizada}', 'false'::jsonb, true),
    updated_at = now()
WHERE plano = 'start';

UPDATE public.plano_config
SET recursos = jsonb_set(COALESCE(recursos, '{}'::jsonb), '{oddPersonalizada}', 'true'::jsonb, true),
    updated_at = now()
WHERE plano IN ('pro', 'elite');