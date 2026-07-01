ALTER TABLE public.bilhetes ADD COLUMN IF NOT EXISTS user_id uuid;

DROP POLICY IF EXISTS "Bilhetes sao publicos" ON public.bilhetes;

CREATE POLICY "Usuarios veem seus bilhetes"
  ON public.bilhetes FOR SELECT
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role));

DROP POLICY IF EXISTS "Palpites sao publicos" ON public.palpites;

CREATE POLICY "Palpites visiveis pelo dono do bilhete"
  ON public.palpites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bilhetes b
      WHERE b.id = palpites.bilhete_id
        AND (b.user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'::public.app_role) OR private.has_role(auth.uid(), 'operador'::public.app_role))
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bilhetes TO authenticated;
GRANT ALL ON public.bilhetes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.palpites TO authenticated;
GRANT ALL ON public.palpites TO service_role;