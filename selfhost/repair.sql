-- ============================================================
--  Reparo idempotente para instalações locais antigas.
--  Pode rodar em toda atualização sem apagar dados.
--  Garante que usuários do auth apareçam no painel Admin.
-- ============================================================

-- Perfis atuais precisam ter os campos usados pela tela de usuários.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS data_nascimento date;

-- GoTrue quebra em algumas instalações antigas quando colunas de token estão NULL.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE auth.users SET
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change = COALESCE(email_change, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      reauthentication_token = COALESCE(reauthentication_token, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, '')
    WHERE confirmation_token IS NULL
       OR recovery_token IS NULL
       OR email_change IS NULL
       OR email_change_token_new IS NULL
       OR email_change_token_current IS NULL
       OR reauthentication_token IS NULL
       OR phone_change IS NULL
       OR phone_change_token IS NULL;
  END IF;
END $$;

-- Trigger correto para novos cadastros: admin padrão nunca vira cliente.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nome, email, cpf, data_nascimento)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', 'Administrador'),
    NEW.email,
    NEW.raw_user_meta_data->>'cpf',
    NULLIF(NEW.raw_user_meta_data->>'data_nascimento','')::date
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nome = COALESCE(public.profiles.nome, EXCLUDED.nome),
    updated_at = now();

  IF lower(NEW.email) = 'contato@protenexus.com'
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::public.app_role)
  THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = NEW.id AND role = 'cliente'::public.app_role;
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'cliente'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Cria perfis que faltaram por trigger quebrado/instalação antiga.
INSERT INTO public.profiles (id, nome, email, cpf, data_nascimento)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'nome', u.raw_user_meta_data->>'full_name'),
  u.email,
  u.raw_user_meta_data->>'cpf',
  NULLIF(u.raw_user_meta_data->>'data_nascimento','')::date
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nome = COALESCE(public.profiles.nome, EXCLUDED.nome),
  updated_at = now();

-- Usuário sem papel não aparece direito; vira cliente por padrão.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'cliente'::public.app_role
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
ON CONFLICT (user_id, role) DO NOTHING;

-- Admin geral fixo: sempre admin, nunca cliente.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'contato@protenexus.com'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM public.user_roles r
USING auth.users u
WHERE r.user_id = u.id
  AND lower(u.email) = 'contato@protenexus.com'
  AND r.role = 'cliente'::public.app_role;

UPDATE public.profiles p
SET nome = 'Administrador', email = 'contato@protenexus.com', updated_at = now()
FROM auth.users u
WHERE p.id = u.id AND lower(u.email) = 'contato@protenexus.com';

-- Fallback seguro para o app listar auth.users sem depender da API Admin do GoTrue.
CREATE OR REPLACE FUNCTION public.admin_list_auth_users()
RETURNS TABLE (
  id uuid,
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT u.id, u.email, u.raw_user_meta_data, u.created_at
  FROM auth.users u
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_auth_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users() TO service_role;

-- Se BYPASSRLS não pegou no service_role, estas policies garantem acesso total
-- somente para chamadas server-side com a chave service role.
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy p
      JOIN pg_class pc ON pc.oid = p.polrelid
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE pn.nspname = 'public'
        AND pc.relname = tbl.table_name
        AND p.polname = 'Service role full access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Service role full access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl.table_name
      );
    END IF;
  END LOOP;
END $$;