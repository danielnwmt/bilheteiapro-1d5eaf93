CREATE TABLE public.api_usage (
  chave text NOT NULL,
  dia date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  total integer NOT NULL DEFAULT 0,
  ultima_chamada timestamptz,
  PRIMARY KEY (chave, dia)
);

GRANT SELECT ON public.api_usage TO authenticated;
GRANT ALL ON public.api_usage TO service_role;

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff lê uso de API" ON public.api_usage
  FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role) OR private.has_role(auth.uid(), 'operador'::app_role));

CREATE OR REPLACE FUNCTION public.increment_api_usage(_chave text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.api_usage (chave, dia, total, ultima_chamada)
  VALUES (_chave, (now() AT TIME ZONE 'America/Sao_Paulo')::date, 1, now())
  ON CONFLICT (chave, dia)
  DO UPDATE SET total = public.api_usage.total + 1, ultima_chamada = now();
END;
$$;