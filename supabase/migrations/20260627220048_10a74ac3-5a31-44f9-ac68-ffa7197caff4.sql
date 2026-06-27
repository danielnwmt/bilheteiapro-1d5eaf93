-- Remove tudo relacionado a Stripe do banco

-- 1) Renomeia a coluna genérica de id de assinatura externa (era stripe_subscription_id)
ALTER TABLE public.subscriptions RENAME COLUMN stripe_subscription_id TO external_subscription_id;

-- 2) Remove a coluna de cliente Stripe (não usada)
ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_customer_id;

-- 3) Remove o price_id (Stripe) da configuração de planos
ALTER TABLE public.plano_config DROP COLUMN IF EXISTS price_id;