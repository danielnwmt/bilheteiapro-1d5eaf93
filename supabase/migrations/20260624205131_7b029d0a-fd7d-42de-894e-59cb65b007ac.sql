CREATE TABLE public.bilhetes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resumo text NOT NULL DEFAULT '',
  odd_total numeric NOT NULL DEFAULT 1,
  risco text NOT NULL DEFAULT 'medio',
  observacoes text,
  casa text NOT NULL DEFAULT 'Betano',
  periodo text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bilhetes TO anon;
GRANT SELECT ON public.bilhetes TO authenticated;
GRANT ALL ON public.bilhetes TO service_role;

ALTER TABLE public.bilhetes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bilhetes sao publicos" ON public.bilhetes
  FOR SELECT TO public USING (true);

CREATE TRIGGER update_bilhetes_updated_at
  BEFORE UPDATE ON public.bilhetes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.palpites
  ADD COLUMN bilhete_id uuid REFERENCES public.bilhetes(id) ON DELETE CASCADE;

CREATE INDEX idx_palpites_bilhete_id ON public.palpites(bilhete_id);