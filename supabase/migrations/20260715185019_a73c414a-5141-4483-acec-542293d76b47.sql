DROP POLICY IF EXISTS "fluxo: todos leem" ON public.chatbot_fluxo;
CREATE POLICY "fluxo: autenticados leem" ON public.chatbot_fluxo FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.chatbot_fluxo FROM anon;