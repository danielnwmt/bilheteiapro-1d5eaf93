
-- Remove policies que dependem dos wrappers públicos
DROP POLICY IF EXISTS "conversas: gestor vê todas" ON public.suporte_conversas;
DROP POLICY IF EXISTS "conversas: gestor atualiza todas" ON public.suporte_conversas;
DROP POLICY IF EXISTS "conversas: gestor apaga" ON public.suporte_conversas;
DROP POLICY IF EXISTS "mensagens: gestor vê todas" ON public.suporte_mensagens;
DROP POLICY IF EXISTS "mensagens: operador vê das suas conversas" ON public.suporte_mensagens;
DROP POLICY IF EXISTS "mensagens: staff insere" ON public.suporte_mensagens;
DROP POLICY IF EXISTS "mensagens: staff atualiza" ON public.suporte_mensagens;
DROP POLICY IF EXISTS "logs: staff insere" ON public.chatbot_logs;
DROP POLICY IF EXISTS "logs: gestor vê todos" ON public.chatbot_logs;
DROP POLICY IF EXISTS "avaliacoes: staff vê todas" ON public.avaliacoes;
DROP POLICY IF EXISTS "respostas: staff lê" ON public.respostas_rapidas;

DROP FUNCTION IF EXISTS public.is_suporte_gestor(uuid);
DROP FUNCTION IF EXISTS public.is_suporte_staff(uuid);

-- Recria com checagens inline (private.has_role)
CREATE POLICY "conversas: gestor vê todas" ON public.suporte_conversas FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role));
CREATE POLICY "conversas: gestor atualiza todas" ON public.suporte_conversas FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role));
CREATE POLICY "conversas: gestor apaga" ON public.suporte_conversas FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role));

CREATE POLICY "mensagens: gestor vê todas" ON public.suporte_mensagens FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role));
CREATE POLICY "mensagens: operador vê das suas conversas" ON public.suporte_mensagens FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'operador'::public.app_role)
         AND EXISTS (SELECT 1 FROM public.suporte_conversas c
                     WHERE c.id = suporte_mensagens.conversa_id
                       AND (c.atendente_id = auth.uid() OR c.atendente_id IS NULL)));
CREATE POLICY "mensagens: staff insere" ON public.suporte_mensagens FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role));
CREATE POLICY "mensagens: staff atualiza" ON public.suporte_mensagens FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role));

CREATE POLICY "logs: staff insere" ON public.chatbot_logs FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role));
CREATE POLICY "logs: gestor vê todos" ON public.chatbot_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role));

CREATE POLICY "avaliacoes: staff vê todas" ON public.avaliacoes FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role));

CREATE POLICY "respostas: staff lê" ON public.respostas_rapidas FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(),'admin'::public.app_role) OR private.has_role(auth.uid(),'supervisor'::public.app_role) OR private.has_role(auth.uid(),'operador'::public.app_role));
