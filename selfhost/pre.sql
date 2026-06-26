-- ============================================================
--  Pré-requisitos para o schema do app rodar no Postgres local.
--  Garante roles, schemas e funções auxiliares do Supabase.
-- ============================================================

-- Roles padrão do Supabase (a imagem supabase/postgres normalmente já cria) ---
DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O GoTrue/Auth precisa rodar como dono do schema auth. Em algumas instalações
-- locais antigas o container tentava migrar como postgres e recebia 42501.
SELECT set_config('app.postgres_password', :'postgres_password', false);
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE format(
      'CREATE ROLE supabase_auth_admin LOGIN NOINHERIT PASSWORD %L',
      current_setting('app.postgres_password', true)
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE supabase_auth_admin WITH LOGIN NOINHERIT PASSWORD %L',
      current_setting('app.postgres_password', true)
    );
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar/alterar supabase_auth_admin; usando role existente.';
END
$pre$;

-- Não usamos BYPASSRLS aqui: em algumas imagens/instalações esse atributo exige
-- superusuário e quebra o setup. O schema cria políticas explícitas para
-- service_role acessar tudo sem depender desse atributo.

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;

-- Repara instalações locais antigas: algumas imagens Supabase vinham com o
-- schema auth/funções pertencendo a outro role, e o Auth travava com 42501.
DO $pre$
DECLARE
  obj record;
BEGIN
  BEGIN
    EXECUTE 'ALTER SCHEMA auth OWNER TO supabase_auth_admin';
  EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
    RAISE NOTICE 'Sem permissão para ajustar dono do schema auth; seguindo.';
  END;

  FOR obj IN
    SELECT c.oid, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relkind IN ('r','p','v','m','S')
  LOOP
    BEGIN
      IF obj.relkind = 'S' THEN
        EXECUTE format('ALTER SEQUENCE %s OWNER TO supabase_auth_admin', obj.oid::regclass);
      ELSE
        EXECUTE format('ALTER TABLE %s OWNER TO supabase_auth_admin', obj.oid::regclass);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Sem permissão para ajustar dono de %; seguindo.', obj.oid::regclass;
    END;
  END LOOP;

  FOR obj IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth'
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s OWNER TO supabase_auth_admin', obj.oid::regprocedure);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Sem permissão para ajustar dono da função %; seguindo.', obj.oid::regprocedure;
    END;
  END LOOP;
END
$pre$;

-- Extensões usadas
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Concede acesso ao schema auth para o GoTrue. Envolvido em bloco para não
-- abortar o setup quando o usuário atual não é membro de supabase_auth_admin.
DO $pre$
BEGIN
  -- Garante que o usuário atual seja membro de supabase_auth_admin, requisito
  -- para rodar ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin.
  BEGIN
    EXECUTE format('GRANT supabase_auth_admin TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sem permissão para virar membro de supabase_auth_admin; seguindo.';
  END;

  BEGIN
    EXECUTE 'GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sem permissão para conceder uso do schema auth; seguindo.';
  END;

  BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO supabase_auth_admin';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO supabase_auth_admin';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO supabase_auth_admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Sem permissão para ajustar default privileges de auth; seguindo.';
  END;
END
$pre$;

-- Acesso ao schema public para a Data API
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- Funções auxiliares de autenticação (compatíveis com Supabase).
-- Em algumas imagens self-host o schema auth já pertence ao GoTrue; nesse caso
-- não tentamos sobrescrever funções existentes para evitar "permission denied".
DO $pre$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.sub', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      $$
    $fn$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar auth.uid(); seguindo com as funções existentes do auth.';
END
$pre$;

DO $pre$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.role', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
        )
      $$
    $fn$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar auth.role(); seguindo com as funções existentes do auth.';
END
$pre$;

DO $pre$
BEGIN
  IF to_regprocedure('auth.email()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.email', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
        )
      $$
    $fn$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar auth.email(); seguindo com as funções existentes do auth.';
END
$pre$;

DO $pre$
BEGIN
  IF to_regprocedure('auth.jwt()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim', true), ''),
          NULLIF(current_setting('request.jwt.claims', true), '')
        )::jsonb
      $$
    $fn$;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sem permissão para criar auth.jwt(); seguindo com as funções existentes do auth.';
END
$pre$;
