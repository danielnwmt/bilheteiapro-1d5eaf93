-- ============================================================
--  Reparo idempotente para instalações locais antigas.
--  Pode rodar em toda atualização sem apagar dados.
--  Garante que usuários do auth apareçam no painel Admin.
-- ============================================================

-- Perfis atuais precisam ter os campos usados pela tela de usuários.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf text,
  ADD COLUMN IF NOT EXISTS data_nascimento date,
  ADD COLUMN IF NOT EXISTS telefone text;

-- Planos dinâmicos: instalações antigas nasceram com enum start/pro/elite.
-- Converte para text e adiciona campos criados depois, sem apagar planos novos.
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    ALTER TABLE public.subscriptions ALTER COLUMN plano TYPE text USING plano::text;
  END IF;
  IF to_regclass('public.plano_config') IS NOT NULL THEN
    ALTER TABLE public.plano_config ALTER COLUMN plano TYPE text USING plano::text;
    ALTER TABLE public.plano_config DROP COLUMN IF EXISTS price_id;
    ALTER TABLE public.plano_config ADD COLUMN IF NOT EXISTS desconto_semestral integer NOT NULL DEFAULT 0;
    ALTER TABLE public.plano_config ADD COLUMN IF NOT EXISTS desconto_anual integer NOT NULL DEFAULT 0;
  END IF;
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    -- Remove tudo relacionado a Stripe das assinaturas
    ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS stripe_customer_id;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name='stripe_subscription_id') THEN
      ALTER TABLE public.subscriptions RENAME COLUMN stripe_subscription_id TO external_subscription_id;
    END IF;
  END IF;
END $$;

-- sync_state tinha RLS sem policy em algumas versões locais.
DO $$
BEGIN
  IF to_regclass('public.sync_state') IS NOT NULL THEN
    ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'sync_state'
        AND p.polname = 'Auth sync state access'
    ) THEN
      CREATE POLICY "Auth sync state access" ON public.sync_state
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
    END IF;
  END IF;
END $$;

-- Depósitos da gestão de banca (foi adicionado depois do schema inicial).
CREATE TABLE IF NOT EXISTS public.banca_entradas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT current_date,
  descricao TEXT NOT NULL,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  odd NUMERIC(8,2) NOT NULL DEFAULT 1,
  resultado TEXT NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banca_entradas TO authenticated;
GRANT ALL ON public.banca_entradas TO service_role;
ALTER TABLE public.banca_entradas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own banca entries" ON public.banca_entradas;
CREATE POLICY "Users manage own banca entries"
ON public.banca_entradas FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_banca_entradas_user ON public.banca_entradas (user_id, data DESC);
DROP TRIGGER IF EXISTS update_banca_entradas_updated_at ON public.banca_entradas;
CREATE TRIGGER update_banca_entradas_updated_at
BEFORE UPDATE ON public.banca_entradas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.banca_depositos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT current_date,
  descricao TEXT NOT NULL DEFAULT 'Aporte',
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banca_depositos TO authenticated;
GRANT ALL ON public.banca_depositos TO service_role;
ALTER TABLE public.banca_depositos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own banca deposits" ON public.banca_depositos;
CREATE POLICY "Users manage own banca deposits"
ON public.banca_depositos FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_banca_depositos_user ON public.banca_depositos (user_id, data DESC);
DROP TRIGGER IF EXISTS update_banca_depositos_updated_at ON public.banca_depositos;
CREATE TRIGGER update_banca_depositos_updated_at
BEFORE UPDATE ON public.banca_depositos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Campo de esporte na banca em instalações antigas.
ALTER TABLE public.banca_entradas ADD COLUMN IF NOT EXISTS esporte text NOT NULL DEFAULT 'futebol';

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

-- Trigger correto para novos cadastros: admin padrão nunca vira cliente e
-- clientes sempre recebem perfil + papel mesmo em instalações antigas.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, nome, email, cpf, data_nascimento, telefone)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      NEW.raw_user_meta_data->>'full_name',
      CASE WHEN lower(NEW.email) = 'contato@protenexus.com' THEN 'Administrador' END
    ),
    NEW.email,
    NEW.raw_user_meta_data->>'cpf',
    NULLIF(NEW.raw_user_meta_data->>'data_nascimento','')::date,
    NEW.raw_user_meta_data->>'telefone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nome = COALESCE(NULLIF(public.profiles.nome, ''), EXCLUDED.nome),
    cpf = COALESCE(NULLIF(public.profiles.cpf, ''), EXCLUDED.cpf),
    data_nascimento = COALESCE(public.profiles.data_nascimento, EXCLUDED.data_nascimento),
    telefone = COALESCE(NULLIF(public.profiles.telefone, ''), EXCLUDED.telefone),
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
INSERT INTO public.profiles (id, nome, email, cpf, data_nascimento, telefone)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'nome', u.raw_user_meta_data->>'full_name'),
  u.email,
  u.raw_user_meta_data->>'cpf',
  NULLIF(u.raw_user_meta_data->>'data_nascimento','')::date,
  u.raw_user_meta_data->>'telefone'
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nome = COALESCE(NULLIF(public.profiles.nome, ''), EXCLUDED.nome),
  cpf = COALESCE(NULLIF(public.profiles.cpf, ''), EXCLUDED.cpf),
  data_nascimento = COALESCE(public.profiles.data_nascimento, EXCLUDED.data_nascimento),
  telefone = COALESCE(NULLIF(public.profiles.telefone, ''), EXCLUDED.telefone),
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
  SELECT u.id, u.email::text, u.raw_user_meta_data, u.created_at
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
END $$;        tbl.table_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
--  Listagem unificada de usuários (admins + clientes) para o painel.
--  SECURITY DEFINER: roda como dono e ignora RLS, então o admin
--  enxerga todos os clientes mesmo quando has_role/RLS estiverem
--  incompletos no self-host. Guardado internamente: só admin/operador
--  (ou o admin padrão) conseguem executar.
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

-- ============================================================
--  Endurecimento de acesso (idempotente):
--  - Restringe edicao direta de perfis a admin (operador so via server fn).
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.plano_config') IS NOT NULL THEN
    REVOKE SELECT ON public.plano_config FROM anon;
    REVOKE SELECT ON public.plano_config FROM authenticated;
    GRANT SELECT (plano, nome, preco, descricao, nivel, historico_dias, ligas, recursos, desconto_semestral, desconto_anual, created_at, updated_at) ON public.plano_config TO anon, authenticated;
    GRANT ALL ON public.plano_config TO service_role;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff edita perfis" ON public.profiles;
    DROP POLICY IF EXISTS "Admin edita perfis" ON public.profiles;
    BEGIN
      CREATE POLICY "Admin edita perfis" ON public.profiles
        FOR UPDATE TO authenticated
        USING (public.has_role(auth.uid(),'admin'))
        WITH CHECK (public.has_role(auth.uid(),'admin'));
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Corrige deeplinks antigos (search?query 404) para busca Google "casa + jogo"
DO $$
BEGIN
  IF to_regclass('public.deep_links') IS NOT NULL THEN
    DELETE FROM public.deep_links;
    INSERT INTO public.deep_links (casa, mercado, url_template) VALUES
      ('Bet365', NULL, 'https://www.google.com/search?q=bet365%20{jogo}'),
      ('Betano', NULL, 'https://www.google.com/search?q=betano%20{jogo}'),
      ('Superbet', NULL, 'https://www.google.com/search?q=superbet%20{jogo}'),
      ('KTO', NULL, 'https://www.google.com/search?q=kto%20{jogo}'),
      ('Sportingbet', NULL, 'https://www.google.com/search?q=sportingbet%20{jogo}'),
      ('Betfair', NULL, 'https://www.google.com/search?q=betfair%20{jogo}');
  END IF;
END $$;
