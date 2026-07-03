CREATE OR REPLACE FUNCTION public.update_suporte_conversas_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversas_updated ON public.suporte_conversas;

CREATE TRIGGER trg_conversas_updated
BEFORE UPDATE ON public.suporte_conversas
FOR EACH ROW
EXECUTE FUNCTION public.update_suporte_conversas_atualizado_em();