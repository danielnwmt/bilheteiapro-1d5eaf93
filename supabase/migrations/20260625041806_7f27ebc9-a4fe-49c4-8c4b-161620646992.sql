-- SUBSCRIPTIONS: drop the broad grants and re-grant column-scoped access that
-- excludes the raw Stripe identifiers for the authenticated (Data API) role.
REVOKE ALL ON public.subscriptions FROM anon;
REVOKE ALL ON public.subscriptions FROM authenticated;

GRANT SELECT (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT INSERT (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT UPDATE (id, user_id, plano, status, periodo_fim, created_at, updated_at)
  ON public.subscriptions TO authenticated;
GRANT DELETE ON public.subscriptions TO authenticated;

-- PROFILES: remove unauthenticated access (no anon policy exists for it).
REVOKE ALL ON public.profiles FROM anon;