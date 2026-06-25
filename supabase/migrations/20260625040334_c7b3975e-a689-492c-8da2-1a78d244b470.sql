-- Perfis para usuarios existentes
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
ON CONFLICT (user_id, role) DO NOTHING;