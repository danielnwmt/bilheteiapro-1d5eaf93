-- ============================================================
--  Rede de segurança: função de listagem de usuários do painel Admin.
--  Aplicada SEMPRE e isoladamente no boot, para garantir que os clientes
--  apareçam mesmo que o repair.sql tenha tido algum aviso/erro pontual.
--  100% idempotente (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  email text,
  nome text,
  cpf text,
  data_nascimento date,
  telefone text,
  created_at timestamptz,
  roles text[],
  plano text,
  status text,
  periodo_fim timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Só executável por service_role (servidor). A autorização do solicitante
  -- (admin/operador) é validada na server function auditada antes de chamar.


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
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO service_role;
