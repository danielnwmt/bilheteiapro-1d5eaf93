CREATE TABLE public.reclamacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conteudo text NOT NULL,
  status text NOT NULL DEFAULT 'aberta',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reclamacoes TO authenticated;
GRANT ALL ON public.reclamacoes TO service_role;

ALTER TABLE public.reclamacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes gerenciam suas reclamacoes"
ON public.reclamacoes FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins veem todas reclamacoes"
ON public.reclamacoes FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins atualizam reclamacoes"
ON public.reclamacoes FOR UPDATE TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_reclamacoes_updated_at
BEFORE UPDATE ON public.reclamacoes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();