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
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.raw_user_meta_data->>'full_name'),
    NEW.email,
    NEW.raw_user_meta_data->>'cpf',
    NULLIF(NEW.raw_user_meta_data->>'data_nascimento','')::date
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'cliente'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF lower(NEW.email) = 'contato@protenexus.com'
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::public.app_role)
  THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(email) = 'contato@protenexus.com'
ON CONFLICT (user_id, role) DO NOTHING;