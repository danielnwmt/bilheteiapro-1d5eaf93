
CREATE OR REPLACE FUNCTION public.is_suporte_gestor(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.has_role(_uid, 'admin'::public.app_role)
      OR private.has_role(_uid, 'supervisor'::public.app_role);
$$;

CREATE OR REPLACE FUNCTION public.is_suporte_staff(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.has_role(_uid, 'admin'::public.app_role)
      OR private.has_role(_uid, 'supervisor'::public.app_role)
      OR private.has_role(_uid, 'operador'::public.app_role);
$$;

-- ============ suporte_conversas ============
CREATE TABLE public.suporte_conversas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  atendente_id uuid,
  atendente_nome text,
  status text NOT NULL DEFAULT 'aberto',
  tags text[] NOT NULL DEFAULT '{}',
  assunto text,
  finalizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suporte_conversas TO authenticated;
GRANT ALL ON public.suporte_conversas TO service_role;
ALTER TABLE public.suporte_conversas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversas: cliente vê as suas" ON public.suporte_conversas FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "conversas: gestor vê todas" ON public.suporte_conversas FOR SELECT TO authenticated
  USING (public.is_suporte_gestor(auth.uid()));
CREATE POLICY "conversas: operador vê fila e as suas" ON public.suporte_conversas FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'operador'::public.app_role)
         AND (atendente_id = auth.uid() OR atendente_id IS NULL));
CREATE POLICY "conversas: cliente cria as suas" ON public.suporte_conversas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conversas: cliente atualiza as suas" ON public.suporte_conversas FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conversas: gestor atualiza todas" ON public.suporte_conversas FOR UPDATE TO authenticated
  USING (public.is_suporte_gestor(auth.uid())) WITH CHECK (public.is_suporte_gestor(auth.uid()));
CREATE POLICY "conversas: operador assume/atualiza" ON public.suporte_conversas FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'operador'::public.app_role)
         AND (atendente_id = auth.uid() OR atendente_id IS NULL))
  WITH CHECK (private.has_role(auth.uid(), 'operador'::public.app_role));
CREATE POLICY "conversas: gestor apaga" ON public.suporte_conversas FOR DELETE TO authenticated
  USING (public.is_suporte_gestor(auth.uid()));

CREATE INDEX idx_conversas_user ON public.suporte_conversas(user_id);
CREATE INDEX idx_conversas_atendente ON public.suporte_conversas(atendente_id);
CREATE INDEX idx_conversas_status ON public.suporte_conversas(status);
CREATE TRIGGER trg_conversas_updated BEFORE UPDATE ON public.suporte_conversas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ suporte_mensagens: novas colunas ============
ALTER TABLE public.suporte_mensagens
  ADD COLUMN IF NOT EXISTS conversa_id uuid REFERENCES public.suporte_conversas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'texto',
  ADD COLUMN IF NOT EXISTS arquivo_url text,
  ADD COLUMN IF NOT EXISTS arquivo_nome text,
  ADD COLUMN IF NOT EXISTS autor_nome text;
CREATE INDEX IF NOT EXISTS idx_mensagens_conversa ON public.suporte_mensagens(conversa_id);

CREATE POLICY "mensagens: gestor vê todas" ON public.suporte_mensagens FOR SELECT TO authenticated
  USING (public.is_suporte_gestor(auth.uid()));
CREATE POLICY "mensagens: operador vê das suas conversas" ON public.suporte_mensagens FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'operador'::public.app_role)
         AND EXISTS (SELECT 1 FROM public.suporte_conversas c
                     WHERE c.id = suporte_mensagens.conversa_id
                       AND (c.atendente_id = auth.uid() OR c.atendente_id IS NULL)));
CREATE POLICY "mensagens: staff insere" ON public.suporte_mensagens FOR INSERT TO authenticated
  WITH CHECK (public.is_suporte_staff(auth.uid()));
CREATE POLICY "mensagens: staff atualiza" ON public.suporte_mensagens FOR UPDATE TO authenticated
  USING (public.is_suporte_staff(auth.uid())) WITH CHECK (public.is_suporte_staff(auth.uid()));

-- ============ chatbot_fluxo ============
CREATE TABLE public.chatbot_fluxo (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatbot_fluxo TO authenticated;
GRANT SELECT ON public.chatbot_fluxo TO anon;
GRANT ALL ON public.chatbot_fluxo TO service_role;
ALTER TABLE public.chatbot_fluxo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fluxo: todos leem" ON public.chatbot_fluxo FOR SELECT USING (true);
CREATE POLICY "fluxo: admin gerencia" ON public.chatbot_fluxo FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_fluxo_updated BEFORE UPDATE ON public.chatbot_fluxo
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ chatbot_logs ============
CREATE TABLE public.chatbot_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  conversa_id uuid,
  evento text NOT NULL,
  detalhes jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chatbot_logs TO authenticated;
GRANT ALL ON public.chatbot_logs TO service_role;
ALTER TABLE public.chatbot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs: cliente cria os seus" ON public.chatbot_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "logs: staff insere" ON public.chatbot_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_suporte_staff(auth.uid()));
CREATE POLICY "logs: cliente vê os seus" ON public.chatbot_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "logs: gestor vê todos" ON public.chatbot_logs FOR SELECT TO authenticated
  USING (public.is_suporte_gestor(auth.uid()));
CREATE INDEX idx_logs_user ON public.chatbot_logs(user_id);
CREATE INDEX idx_logs_conversa ON public.chatbot_logs(conversa_id);

-- ============ avaliacoes ============
CREATE TABLE public.avaliacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversa_id uuid NOT NULL REFERENCES public.suporte_conversas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  nota int NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.avaliacoes TO authenticated;
GRANT ALL ON public.avaliacoes TO service_role;
ALTER TABLE public.avaliacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avaliacoes: cliente cria as suas" ON public.avaliacoes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "avaliacoes: cliente vê as suas" ON public.avaliacoes FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "avaliacoes: staff vê todas" ON public.avaliacoes FOR SELECT TO authenticated
  USING (public.is_suporte_staff(auth.uid()));
CREATE INDEX idx_avaliacoes_conversa ON public.avaliacoes(conversa_id);

-- ============ respostas_rapidas ============
CREATE TABLE public.respostas_rapidas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  atalho text NOT NULL,
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.respostas_rapidas TO authenticated;
GRANT ALL ON public.respostas_rapidas TO service_role;
ALTER TABLE public.respostas_rapidas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "respostas: staff lê" ON public.respostas_rapidas FOR SELECT TO authenticated
  USING (public.is_suporte_staff(auth.uid()));
CREATE POLICY "respostas: admin gerencia" ON public.respostas_rapidas FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE TRIGGER trg_respostas_updated BEFORE UPDATE ON public.respostas_rapidas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ suporte_config ============
CREATE TABLE public.suporte_config (
  id boolean NOT NULL DEFAULT true PRIMARY KEY CHECK (id),
  dias jsonb NOT NULL DEFAULT '{}'::jsonb,
  mensagem_offline text NOT NULL DEFAULT 'Nosso suporte está offline. Responderemos assim que possível.',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.suporte_config TO authenticated;
GRANT SELECT ON public.suporte_config TO anon;
GRANT ALL ON public.suporte_config TO service_role;
ALTER TABLE public.suporte_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config: todos leem" ON public.suporte_config FOR SELECT USING (true);
CREATE POLICY "config: admin gerencia" ON public.suporte_config FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
INSERT INTO public.suporte_config (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ============ reclamacoes: novos campos ============
ALTER TABLE public.reclamacoes
  ADD COLUMN IF NOT EXISTS resposta text,
  ADD COLUMN IF NOT EXISTS resolvido_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivada boolean NOT NULL DEFAULT false;

-- ============ Migração de dados ============
INSERT INTO public.suporte_conversas (user_id, status, criado_em, atualizado_em, finalizado_em)
SELECT m.user_id,
       CASE WHEN COALESCE(s.encerrada, false) THEN 'finalizado' ELSE 'aberto' END,
       MIN(m.created_at), MAX(m.created_at),
       CASE WHEN COALESCE(s.encerrada, false) THEN COALESCE(s.encerrada_em, MAX(m.created_at)) END
FROM public.suporte_mensagens m
LEFT JOIN public.suporte_status s ON s.user_id = m.user_id
WHERE m.conversa_id IS NULL
GROUP BY m.user_id, s.encerrada, s.encerrada_em;

UPDATE public.suporte_mensagens m
SET conversa_id = c.id
FROM public.suporte_conversas c
WHERE m.conversa_id IS NULL AND c.user_id = m.user_id;

-- ============ Realtime ============
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_conversas; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.suporte_mensagens; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.reclamacoes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.avaliacoes; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
ALTER TABLE public.suporte_conversas REPLICA IDENTITY FULL;
ALTER TABLE public.suporte_mensagens REPLICA IDENTITY FULL;
