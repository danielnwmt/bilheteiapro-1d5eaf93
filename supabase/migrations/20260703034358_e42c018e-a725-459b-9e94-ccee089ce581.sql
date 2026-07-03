CREATE TABLE public.suporte_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encerrada boolean NOT NULL DEFAULT false,
  encerrada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suporte_status TO authenticated;
GRANT ALL ON public.suporte_status TO service_role;

ALTER TABLE public.suporte_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "le status proprio ou admin" ON public.suporte_status
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin gerencia status" ON public.suporte_status
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_suporte_status_updated_at
  BEFORE UPDATE ON public.suporte_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();