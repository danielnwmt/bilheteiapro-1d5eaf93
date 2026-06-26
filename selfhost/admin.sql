-- ============================================================
--  Garante PERFIL + PAPEL admin para o usuário padrão.
--  NÃO cria o usuário em auth.users (isso é feito pela API do
--  GoTrue em create-admin.sh, que é compatível com a versão real
--  do Auth). Aqui só promovemos a admin quem já existe.
-- ============================================================

CREATE TEMP TABLE IF NOT EXISTS admin_bootstrap_vars (
  admin_email text NOT NULL
) ON COMMIT DROP;

TRUNCATE admin_bootstrap_vars;

INSERT INTO admin_bootstrap_vars (admin_email)
VALUES (:'admin_email');

DO $$
DECLARE
  v_email text;
  v_uid   uuid;
BEGIN
  SELECT admin_email INTO v_email FROM admin_bootstrap_vars LIMIT 1;

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
