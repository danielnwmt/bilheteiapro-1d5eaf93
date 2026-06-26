ALTER TABLE public.plano_config
  ADD COLUMN IF NOT EXISTS desconto_semestral integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_anual integer NOT NULL DEFAULT 0;