CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _nasc date;
BEGIN
  -- Compliance: bloqueia cadastro de menores de 18 anos.
  _nasc := NULLIF(NEW.raw_user_meta_data->>'data_nascimento','')::date;
  IF _nasc IS NOT NULL AND _nasc > (CURRENT_DATE - INTERVAL '18 years') THEN
    RAISE EXCEPTION 'Apenas maiores de 18 anos podem se cadastrar na plataforma.';
  END IF;

  INSERT INTO public.profiles (id, nome, email, cpf, data_nascimento, telefone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name', 'Administrador'),
    NEW.email,
    NEW.raw_user_meta_data->>'cpf',
    _nasc,
    NEW.raw_user_meta_data->>'telefone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nome = COALESCE(public.profiles.nome, EXCLUDED.nome),
    telefone = COALESCE(public.profiles.telefone, EXCLUDED.telefone),
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