-- ============================================================
--  Pré-requisitos para o schema do app rodar no Postgres local.
--  Garante roles, schemas e funções auxiliares do Supabase.
-- ============================================================

-- Roles padrão do Supabase (a imagem supabase/postgres normalmente já cria) ---
DO $$ BEGIN CREATE ROLE anon NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Não usamos BYPASSRLS aqui: em algumas imagens/instalações esse atributo exige
-- superusuário e quebra o setup. O schema cria políticas explícitas para
-- service_role acessar tudo sem depender desse atributo.

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;

-- Extensões usadas
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
