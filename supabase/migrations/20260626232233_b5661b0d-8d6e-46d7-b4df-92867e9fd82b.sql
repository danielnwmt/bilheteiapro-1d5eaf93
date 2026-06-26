-- Restrict direct Data API reads of sensitive personal/payment data to admins only.
-- Operador keeps access through audited service-role server functions.

DROP POLICY IF EXISTS "Staff ve todos perfis" ON public.profiles;
CREATE POLICY "Admin ve todos perfis"
ON public.profiles
FOR SELECT
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Staff ve todas assinaturas" ON public.subscriptions;
CREATE POLICY "Admin ve todas assinaturas"
ON public.subscriptions
FOR SELECT
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role));