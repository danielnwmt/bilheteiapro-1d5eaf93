CREATE TABLE public.banca_depositos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data date NOT NULL DEFAULT CURRENT_DATE,
  descricao text NOT NULL DEFAULT '',
  valor numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.banca_depositos TO authenticated;
GRANT ALL ON public.banca_depositos TO service_role;

ALTER TABLE public.banca_depositos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own banca deposits"
ON public.banca_depositos FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_banca_depositos_user ON public.banca_depositos (user_id, data DESC);

CREATE TRIGGER update_banca_depositos_updated_at
BEFORE UPDATE ON public.banca_depositos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();