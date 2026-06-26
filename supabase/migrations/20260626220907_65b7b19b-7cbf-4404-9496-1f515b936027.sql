ALTER TABLE public.plano_config ALTER COLUMN plano TYPE text USING plano::text;
ALTER TABLE public.plano_config ALTER COLUMN price_id SET DEFAULT '';
ALTER TABLE public.subscriptions ALTER COLUMN plano TYPE text USING plano::text;