-- Move SECURITY DEFINER helper functions out of the API-exposed `public` schema
-- into a `private` schema so signed-in users can no longer call them as RPC,
-- while RLS policies keep working.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Recreate helpers in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.plano_ativo(_user_id uuid)
RETURNS public.plano_tipo
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plano FROM public.subscriptions
  WHERE user_id = _user_id AND status = 'ativo'
    AND (periodo_fim IS NULL OR periodo_fim > now())
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.plano_ativo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.plano_ativo(uuid) TO authenticated, service_role;

-- Repoint every RLS policy to the private function
ALTER POLICY "Staff ve todos os papeis" ON public.user_roles
  USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

ALTER POLICY "Admin gerencia papeis" ON public.user_roles
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

ALTER POLICY "Staff ve todos perfis" ON public.profiles
  USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

ALTER POLICY "Staff edita perfis" ON public.profiles
  USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

ALTER POLICY "Staff ve todas assinaturas" ON public.subscriptions
  USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

ALTER POLICY "Staff gerencia assinaturas" ON public.subscriptions
  USING (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

ALTER POLICY "Admin gerencia config" ON public.system_config
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

-- Drop the API-exposed copies
DROP FUNCTION public.has_role(uuid, public.app_role);
DROP FUNCTION public.plano_ativo(uuid);