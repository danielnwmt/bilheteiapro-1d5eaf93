-- ============================================================
-- Fallback local: cria/atualiza o admin direto no banco auth.
-- Usado só quando a API Admin do Auth não responde durante setup.
-- ============================================================

SELECT set_config('bia.admin_email', :'admin_email', false);
SELECT set_config('bia.admin_password', :'admin_password', false);

DO $$
DECLARE
  v_email text := lower(current_setting('bia.admin_email', true));
  v_password text := current_setting('bia.admin_password', true);
  v_uid uuid;
  v_cols text[] := ARRAY[]::text[];
  v_vals text[] := ARRAY[]::text[];
  v_sql text;
BEGIN
  IF v_email IS NULL OR v_email = '' OR v_password IS NULL OR v_password = '' THEN
    RAISE EXCEPTION 'admin_email/admin_password nao informados';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'auth.users ainda nao existe';
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_uid IS NULL THEN
    v_uid := gen_random_uuid();

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='instance_id' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'instance_id');
      v_vals := array_append(v_vals, quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='id' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'id');
      v_vals := array_append(v_vals, quote_literal(v_uid::text) || '::uuid');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='aud' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'aud');
      v_vals := array_append(v_vals, quote_literal('authenticated'));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='role' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'role');
      v_vals := array_append(v_vals, quote_literal('authenticated'));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='email' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email');
      v_vals := array_append(v_vals, quote_literal(v_email));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='encrypted_password' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'encrypted_password');
      v_vals := array_append(v_vals, format('crypt(%L, gen_salt(''bf''))', v_password));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='email_confirmed_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email_confirmed_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='confirmed_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'confirmed_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='raw_app_meta_data' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'raw_app_meta_data');
      v_vals := array_append(v_vals, quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='raw_user_meta_data' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'raw_user_meta_data');
      v_vals := array_append(v_vals, quote_literal('{"nome":"Administrador"}') || '::jsonb');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='created_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'created_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='updated_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'updated_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='confirmation_token' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'confirmation_token');
      v_vals := array_append(v_vals, quote_literal(''));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='recovery_token' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'recovery_token');
      v_vals := array_append(v_vals, quote_literal(''));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='email_change_token_new' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email_change_token_new');
      v_vals := array_append(v_vals, quote_literal(''));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='email_change_token_current' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email_change_token_current');
      v_vals := array_append(v_vals, quote_literal(''));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='email_change_confirm_status' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email_change_confirm_status');
      v_vals := array_append(v_vals, '0');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='reauthentication_token' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'reauthentication_token');
      v_vals := array_append(v_vals, quote_literal(''));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='is_sso_user' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'is_sso_user');
      v_vals := array_append(v_vals, 'false');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name='is_anonymous' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'is_anonymous');
      v_vals := array_append(v_vals, 'false');
    END IF;

    v_sql := 'INSERT INTO auth.users (' || array_to_string(v_cols, ',') || ') VALUES (' || array_to_string(v_vals, ',') || ')';
    EXECUTE v_sql;
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt(v_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_uid;
  END IF;

  IF to_regclass('auth.identities') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='provider')
     AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid AND provider = 'email') THEN
    v_cols := ARRAY[]::text[];
    v_vals := ARRAY[]::text[];

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='id' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'id');
      v_vals := array_append(v_vals, quote_literal(v_uid::text));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='user_id' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'user_id');
      v_vals := array_append(v_vals, quote_literal(v_uid::text) || '::uuid');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='provider' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'provider');
      v_vals := array_append(v_vals, quote_literal('email'));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='provider_id' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'provider_id');
      v_vals := array_append(v_vals, quote_literal(v_email));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='email' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'email');
      v_vals := array_append(v_vals, quote_literal(v_email));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='identity_data' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'identity_data');
      v_vals := array_append(v_vals, format('%L::jsonb', jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false)::text));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='created_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'created_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='updated_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'updated_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' AND column_name='last_sign_in_at' AND COALESCE(is_generated, 'NEVER') = 'NEVER') THEN
      v_cols := array_append(v_cols, 'last_sign_in_at');
      v_vals := array_append(v_vals, 'now()');
    END IF;

    EXECUTE 'INSERT INTO auth.identities (' || array_to_string(v_cols, ',') || ') VALUES (' || array_to_string(v_vals, ',') || ')';
  END IF;

  RAISE NOTICE 'Admin auth garantido via fallback SQL: %', v_email;
END $$;