-- 1) plano_config: ocultar price_id de anon/authenticated (column-level)
REVOKE SELECT ON public.plano_config FROM anon;
REVOKE SELECT ON public.plano_config FROM authenticated;
GRANT SELECT (plano, nome, preco, descricao, nivel, historico_dias, ligas, recursos, created_at, updated_at, desconto_semestral, desconto_anual) ON public.plano_config TO anon;
GRANT SELECT (plano, nome, preco, descricao, nivel, historico_dias, ligas, recursos, created_at, updated_at, desconto_semestral, desconto_anual) ON public.plano_config TO authenticated;
GRANT ALL ON public.plano_config TO service_role;

-- 2) profiles: remover UPDATE direto de operadores; restringir a admin
DROP POLICY IF EXISTS "Staff edita perfis" ON public.profiles;
CREATE POLICY "Admin edita perfis"
ON public.profiles
FOR UPDATE
TO authenticated
USING (private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

-- 3) admin_list_users: não executável por usuários logados; somente service_role
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, email text, nome text, cpf text, data_nascimento date, telefone text, created_at timestamp with time zone, roles text[], plano text, status text, periodo_fim timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  -- Esta função só pode ser executada por service_role (servidor). A
  -- autorização do solicitante (admin/operador) é feita na server function
  -- auditada antes de chamá-la.
  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    COALESCE(p.nome, u.raw_user_meta_data->>'nome', u.raw_user_meta_data->>'full_name'),
    COALESCE(p.cpf, u.raw_user_meta_data->>'cpf'),
    COALESCE(p.data_nascimento, NULLIF(u.raw_user_meta_data->>'data_nascimento','')::date),
    COALESCE(p.telefone, u.raw_user_meta_data->>'telefone'),
    COALESCE(p.created_at, u.created_at),
    COALESCE((SELECT array_agg(r.role::text) FROM public.user_roles r WHERE r.user_id = u.id), ARRAY[]::text[]),
    s.plano,
    s.status,
    s.periodo_fim
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN LATERAL (
    SELECT sub.plano, sub.status, sub.periodo_fim
    FROM public.subscriptions sub
    WHERE sub.user_id = u.id
    ORDER BY sub.created_at DESC
    LIMIT 1
  ) s ON true
  ORDER BY COALESCE(p.created_at, u.created_at) DESC;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO service_role;