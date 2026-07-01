ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen timestamptz;

-- Função que registra atividade (heartbeat) do usuário logado.
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles SET last_seen = now() WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.touch_last_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated, service_role;