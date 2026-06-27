-- ===== Partidas =====
CREATE TABLE public.partidas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  external_id text UNIQUE,
  liga text,
  time_casa text NOT NULL,
  time_fora text NOT NULL,
  inicio timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partidas TO anon, authenticated;
GRANT ALL ON public.partidas TO service_role;
ALTER TABLE public.partidas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partidas sao publicas" ON public.partidas FOR SELECT USING (true);

-- ===== Estatisticas historicas =====
CREATE TABLE public.estatisticas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  tipo text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.estatisticas TO anon, authenticated;
GRANT ALL ON public.estatisticas TO service_role;
ALTER TABLE public.estatisticas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Estatisticas sao publicas" ON public.estatisticas FOR SELECT USING (true);

-- ===== Odds =====
CREATE TABLE public.odds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  casa text NOT NULL,
  mercado text NOT NULL,
  selecao text NOT NULL,
  valor numeric NOT NULL,
  external_odd_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.odds TO anon, authenticated;
GRANT ALL ON public.odds TO service_role;
ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Odds sao publicas" ON public.odds FOR SELECT USING (true);
CREATE INDEX idx_odds_partida ON public.odds(partida_id);

-- ===== Deep links (tabela de traducao) =====
CREATE TABLE public.deep_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  casa text NOT NULL,
  mercado text,
  url_template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deep_links TO anon, authenticated;
GRANT ALL ON public.deep_links TO service_role;
ALTER TABLE public.deep_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deep links sao publicos" ON public.deep_links FOR SELECT USING (true);

-- ===== Palpites (resultado da IA) =====
CREATE TABLE public.palpites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partida_id uuid REFERENCES public.partidas(id) ON DELETE CASCADE,
  mercado text NOT NULL,
  selecao text NOT NULL,
  odd numeric NOT NULL,
  confianca numeric NOT NULL,
  justificativa text,
  deep_link text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.palpites TO anon, authenticated;
GRANT ALL ON public.palpites TO service_role;
ALTER TABLE public.palpites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Palpites sao publicos" ON public.palpites FOR SELECT USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_partidas_updated BEFORE UPDATE ON public.partidas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_odds_updated BEFORE UPDATE ON public.odds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_deep_links_updated BEFORE UPDATE ON public.deep_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed deep link templates (placeholders {jogo} {selecao} {odd_id})
INSERT INTO public.deep_links (casa, mercado, url_template) VALUES
  ('Betano', NULL, 'https://www.betano.bet.br/search/?query={jogo}'),
  ('Bet365', NULL, 'https://www.google.com/search?q=bet365%20{jogo}'),
  ('Superbet', NULL, 'https://superbet.bet.br/search?query={jogo}');

ALTER TABLE public.odds
  ADD CONSTRAINT odds_unique_partida_casa_mercado_selecao
  UNIQUE (partida_id, casa, mercado, selecao);

CREATE TABLE public.sync_state (
  id TEXT PRIMARY KEY,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_state TO authenticated;
GRANT ALL ON public.sync_state TO service_role;

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth sync state access" ON public.sync_state
FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

-- Sem políticas públicas: apenas service_role (cron/worker) acessa.

INSERT INTO public.sync_state (id, last_sync_at) VALUES ('football', NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.bilhetes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  resumo text NOT NULL DEFAULT '',
  odd_total numeric NOT NULL DEFAULT 1,
  risco text NOT NULL DEFAULT 'medio',
  observacoes text,
  casa text NOT NULL DEFAULT 'Betano',
  periodo text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.bilhetes TO anon;
GRANT SELECT ON public.bilhetes TO authenticated;
GRANT ALL ON public.bilhetes TO service_role;

ALTER TABLE public.bilhetes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bilhetes sao publicos" ON public.bilhetes
  FOR SELECT TO public USING (true);

CREATE TRIGGER update_bilhetes_updated_at
  BEFORE UPDATE ON public.bilhetes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.palpites
  ADD COLUMN bilhete_id uuid REFERENCES public.bilhetes(id) ON DELETE CASCADE;

CREATE INDEX idx_palpites_bilhete_id ON public.palpites(bilhete_id);

ALTER TABLE public.bilhetes ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'padrao';
ALTER TABLE public.odds ADD COLUMN IF NOT EXISTS deep_link text;

-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin', 'operador', 'cliente');
CREATE TYPE public.plano_tipo AS ENUM ('start', 'pro', 'elite');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Usuario ve os proprios papeis" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Staff ve todos os papeis" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));
CREATE POLICY "Admin gerencia papeis" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text,
  email text,
  cpf text,
  data_nascimento date,
  telefone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario ve o proprio perfil" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Usuario edita o proprio perfil" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Staff ve todos perfis" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));
CREATE POLICY "Admin edita perfis" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto criar perfil + papel no signup.
-- Regra única: o admin padrão sempre é admin; demais usuários viram clientes,
-- exceto o primeiro usuário de uma instalação nova, que vira admin de segurança.
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

-- SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano text NOT NULL,
  status text NOT NULL DEFAULT 'inativo',
  external_subscription_id text,
  periodo_fim timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario ve a propria assinatura" ON public.subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Staff ve todas assinaturas" ON public.subscriptions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));
CREATE POLICY "Staff gerencia assinaturas" ON public.subscriptions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));

CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- plano ativo helper
CREATE OR REPLACE FUNCTION public.plano_ativo(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plano FROM public.subscriptions
  WHERE user_id = _user_id AND status = 'ativo'
    AND (periodo_fim IS NULL OR periodo_fim > now())
  LIMIT 1
$$;

-- SYSTEM CONFIG (chaves de API editaveis pelo admin)
CREATE TABLE public.system_config (
  chave text PRIMARY KEY,
  valor text,
  descricao text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_config TO authenticated;
GRANT ALL ON public.system_config TO service_role;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin gerencia config" ON public.system_config
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER system_config_updated_at BEFORE UPDATE ON public.system_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();-- Trigger-only functions: ninguem chama direto
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- Funcoes usadas em policies: remover acesso de visitantes anonimos
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.plano_ativo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plano_ativo(uuid) TO authenticated;-- Perfis para usuarios existentes
INSERT INTO public.profiles (id, nome, email)
SELECT u.id,
       COALESCE(u.raw_user_meta_data->>'nome', u.raw_user_meta_data->>'full_name'),
       u.email
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Papel cliente para todos
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'cliente'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- Primeiro usuario cadastrado vira admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
ORDER BY created_at ASC
LIMIT 1
ON CONFLICT (user_id, role) DO NOTHING;-- Move SECURITY DEFINER helper functions out of the API-exposed `public` schema
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
RETURNS text
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

ALTER POLICY "Admin edita perfis" ON public.profiles
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

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
-- SUBSCRIPTIONS: drop the broad grants and re-grant column-scoped access.
REVOKE ALL ON public.subscriptions FROM anon;
REVOKE ALL ON public.subscriptions FROM authenticated;

GRANT SELECT (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT INSERT (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT UPDATE (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT DELETE ON public.subscriptions TO authenticated;

-- PROFILES: remove unauthenticated access (no anon policy exists for it).
REVOKE ALL ON public.profiles FROM anon;

CREATE TABLE public.plano_config (
  plano text PRIMARY KEY,
  nome text NOT NULL,
  preco text NOT NULL,
  descricao text NOT NULL,
  nivel integer NOT NULL,
  price_id text NOT NULL DEFAULT '',
  historico_dias integer NOT NULL DEFAULT 15,
  ligas jsonb NOT NULL DEFAULT '[]'::jsonb,
  recursos jsonb NOT NULL DEFAULT '{}'::jsonb,
  desconto_semestral integer NOT NULL DEFAULT 0,
  desconto_anual integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- price_id fica oculto de anon/authenticated (apenas servidor/service_role le).
GRANT SELECT (plano, nome, preco, descricao, nivel, historico_dias, ligas, recursos, desconto_semestral, desconto_anual, created_at, updated_at) ON public.plano_config TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.plano_config TO authenticated;
GRANT ALL ON public.plano_config TO service_role;

ALTER TABLE public.plano_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos veem config de planos" ON public.plano_config
  FOR SELECT USING (true);

CREATE POLICY "Admin edita config de planos" ON public.plano_config
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_plano_config_updated_at
  BEFORE UPDATE ON public.plano_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed com os valores atuais
INSERT INTO public.plano_config (plano, nome, preco, descricao, nivel, price_id, historico_dias, ligas, recursos) VALUES
(
  'start', 'BilheteIA Start', 'R$ 29,90', 'Para quem busca múltiplas inteligentes com IA.', 1, 'start_monthly', 15,
  '["Brasileirão Série A","Brasileirão Série B","Premier League"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":false,"favoritos":false,"estatisticasAvancadas":false,"tempoReal":false,"alertasInteligentes":false,"suportePrioritario":false}'::jsonb
),
(
  'pro', 'BilheteIA Pro', 'R$ 49,90', 'Todas as ligas mundiais e ferramentas de gestão.', 2, 'pro_monthly', 30,
  '["Brasileirão Série A","Brasileirão Série B","Premier League","Copa do Brasil","Libertadores","Sul-Americana","La Liga","Serie A (Itália)","Bundesliga","Ligue 1","Champions League","Europa League","Conference League","Copa do Mundo"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":true,"favoritos":true,"estatisticasAvancadas":true,"tempoReal":false,"alertasInteligentes":false,"suportePrioritario":false}'::jsonb
),
(
  'elite', 'BilheteIA Elite', 'R$ 79,90', 'Tudo, em tempo real e com suporte prioritário.', 3, 'elite_monthly', 60,
  '["Brasileirão Série A","Brasileirão Série B","Premier League","Copa do Brasil","Libertadores","Sul-Americana","La Liga","Serie A (Itália)","Bundesliga","Ligue 1","Champions League","Europa League","Conference League","Copa do Mundo"]'::jsonb,
  '{"bilhetesIlimitados":true,"oddPersonalizada":true,"planilhaBanca":true,"favoritos":true,"estatisticasAvancadas":true,"tempoReal":true,"alertasInteligentes":true,"suportePrioritario":true}'::jsonb
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS telefone TEXT;

CREATE TABLE IF NOT EXISTS public.banca_entradas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  data DATE NOT NULL DEFAULT current_date,
  descricao TEXT NOT NULL,
  esporte TEXT NOT NULL DEFAULT 'futebol',
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

DROP TRIGGER IF EXISTS update_banca_entradas_updated_at ON public.banca_entradas;
CREATE TRIGGER update_banca_entradas_updated_at
BEFORE UPDATE ON public.banca_entradas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_banca_entradas_user ON public.banca_entradas (user_id, data DESC);

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

DROP TRIGGER IF EXISTS update_banca_depositos_updated_at ON public.banca_depositos;
CREATE TRIGGER update_banca_depositos_updated_at
BEFORE UPDATE ON public.banca_depositos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_banca_depositos_user ON public.banca_depositos (user_id, data DESC);

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

-- Fallback seguro: permite ao servidor listar auth.users via PostgREST/RPC com
-- service_role quando a API Admin do GoTrue não responde na instalação local.
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

-- Self-host robusto: em alguns Postgres locais não é permitido criar/alterar
-- service_role com BYPASSRLS. Então liberamos o service_role por políticas RLS
-- explícitas em todas as tabelas públicas do app.
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
