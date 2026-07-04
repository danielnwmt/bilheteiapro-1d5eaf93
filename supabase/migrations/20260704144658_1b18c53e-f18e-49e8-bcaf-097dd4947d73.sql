CREATE TABLE public.suporte_faq (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  categoria TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT true,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.suporte_faq TO authenticated;
GRANT ALL ON public.suporte_faq TO service_role;

ALTER TABLE public.suporte_faq ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados leem FAQ ativa"
  ON public.suporte_faq FOR SELECT TO authenticated
  USING (ativo = true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_suporte_faq_updated_at
  BEFORE UPDATE ON public.suporte_faq
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();