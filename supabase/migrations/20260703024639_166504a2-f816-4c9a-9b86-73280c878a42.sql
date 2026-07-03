CREATE TABLE public.suporte_mensagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  autor TEXT NOT NULL CHECK (autor IN ('cliente','suporte')),
  conteudo TEXT NOT NULL,
  lida BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suporte_mensagens TO authenticated;
GRANT ALL ON public.suporte_mensagens TO service_role;

ALTER TABLE public.suporte_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suporte_select" ON public.suporte_mensagens FOR SELECT TO authenticated
USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "suporte_insert" ON public.suporte_mensagens FOR INSERT TO authenticated
WITH CHECK (
  (user_id = auth.uid() AND autor = 'cliente')
  OR (private.has_role(auth.uid(), 'admin'::public.app_role) AND autor = 'suporte')
);

CREATE POLICY "suporte_update" ON public.suporte_mensagens FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX idx_suporte_mensagens_user ON public.suporte_mensagens(user_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_mensagens;