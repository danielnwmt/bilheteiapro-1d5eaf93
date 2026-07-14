DO $$
BEGIN
  IF to_regclass('public.sync_state') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role manages sync state" ON public.sync_state;
    CREATE POLICY "Service role manages sync state"
      ON public.sync_state
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DROP EXTENSION IF EXISTS pg_net;