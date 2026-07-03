
CREATE POLICY "anexos: dono ou staff leem" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'suporte-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.has_role(auth.uid(),'admin'::public.app_role)
      OR private.has_role(auth.uid(),'supervisor'::public.app_role)
      OR private.has_role(auth.uid(),'operador'::public.app_role)
    )
  );

CREATE POLICY "anexos: dono ou staff enviam" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'suporte-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.has_role(auth.uid(),'admin'::public.app_role)
      OR private.has_role(auth.uid(),'supervisor'::public.app_role)
      OR private.has_role(auth.uid(),'operador'::public.app_role)
    )
  );

CREATE POLICY "anexos: dono ou staff apagam" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'suporte-anexos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR private.has_role(auth.uid(),'admin'::public.app_role)
      OR private.has_role(auth.uid(),'supervisor'::public.app_role)
    )
  );
