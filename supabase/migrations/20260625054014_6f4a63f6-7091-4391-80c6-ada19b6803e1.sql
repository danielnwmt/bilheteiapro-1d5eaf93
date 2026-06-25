CREATE TABLE public.banca_entradas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT current_date,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  odd NUMERIC(8,2) NOT NULL DEFAULT 1,
  resultado TEXT NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.banca_entradas TO authenticated;
GRANT ALL ON public.banca_entradas TO service_role;

ALTER TABLE public.banca_entradas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own banca entries"
ON public.banca_entradas FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_banca_entradas_updated_at
BEFORE UPDATE ON public.banca_entradas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_banca_entradas_user ON public.banca_entradas (user_id, data DESC);