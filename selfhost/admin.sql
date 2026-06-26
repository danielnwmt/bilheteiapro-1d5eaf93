-- ============================================================
--  Cria/garante o admin padrão diretamente no banco local.
--  Email/senha definidos em setup.sh (ADMIN_EMAIL / ADMIN_PASSWORD).
--  A senha é gravada como bcrypt (compatível com GoTrue).
-- ============================================================

CREATE TEMP TABLE IF NOT EXISTS admin_bootstrap_vars (
  admin_email text NOT NULL,
  admin_password text NOT NULL
) ON COMMIT DROP;

TRUNCATE admin_bootstrap_vars;

INSERT INTO admin_bootstrap_vars (admin_email, admin_password)
VALUES (:'admin_email', :'admin_password');

DO $$
DECLARE
  v_email   text;
  v_pass    text;
  v_uid     uuid;
BEGIN
  SELECT admin_email, admin_password
    INTO v_email, v_pass
    FROM admin_bootstrap_vars
    LIMIT 1;

  -- Usuário já existe?
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current,
      reauthentication_token,
      created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', lower(v_email),
      crypt(v_pass, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome','Administrador'),
      '', '', '', '', '', '',
      now(), now()
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', lower(v_email), 'email_verified', true),
      'email', now(), now(), now()
    );
  ELSE
    -- Garante senha e confirmação
    UPDATE auth.users
       SET encrypted_password = crypt(v_pass, gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_uid;
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

  RAISE NOTICE 'Admin pronto: %', v_email;
END $$;
