ALTER TABLE public.bilhetes
  ADD COLUMN IF NOT EXISTS confianca numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS url_deeplink text;