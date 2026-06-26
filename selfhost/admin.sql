-- ============================================================
--  Garante PERFIL + PAPEL admin para o usuário padrão.
--  NÃO cria o usuário em auth.users (isso é feito pela API do
--  GoTrue em create-admin.sh, que é compatível com a versão real
--  do Auth). Aqui só promovemos a admin quem já existe.
--
--  Recebe o e-mail via -v admin_email=... (psql).
--  Usamos set_config() (sessão) em vez de TEMP TABLE para evitar
--  o problema de "ON COMMIT DROP" em autocommit.
-- ============================================================

SELECT set_config('bia.admin_email', :'admin_email', false);

DO $$
DECLARE
  v_email text;
  v_uid   uuid;
BEGIN
  v_email := current_setting('bia.admin_email', true);

  IF v_email IS NULL OR v_email = '' THEN
    RAISE NOTICE 'admin_email nao informado; nada a fazer.';
    RETURN;
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_uid IS NULL THEN
    RAISE NOTICE 'Usuario % ainda nao existe em auth.users; create-admin.sh deve cria-lo via API.', v_email;
    RETURN;
  END IF;

  -- Perfil
  INSERT INTO public.profiles (id, nome, email)
  VALUES (v_uid, 'Administrador', lower(v_email))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();

  -- Papel admin (e remove cliente)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = v_uid AND role = 'cliente'::public.app_role;

  RAISE NOTICE 'Admin garantido: %', v_email;
END $$;
