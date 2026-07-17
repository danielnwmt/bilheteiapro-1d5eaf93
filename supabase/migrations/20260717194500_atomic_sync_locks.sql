-- Locks atômicos para impedir crons/API duplicados em múltiplas instâncias.
ALTER TABLE public.sync_state
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS lock_token text,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_finished_at timestamptz;

CREATE OR REPLACE FUNCTION public.acquire_sync_lock(
  p_id text,
  p_interval_seconds integer,
  p_ttl_seconds integer,
  p_lock_token text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acquired boolean := false;
BEGIN
  INSERT INTO public.sync_state (id, last_sync_at, locked_until, lock_token, updated_at)
  VALUES (p_id, NULL, now() + make_interval(secs => p_ttl_seconds), p_lock_token, now())
  ON CONFLICT (id) DO UPDATE
  SET locked_until = EXCLUDED.locked_until,
      lock_token = EXCLUDED.lock_token,
      updated_at = now()
  WHERE
    (sync_state.locked_until IS NULL OR sync_state.locked_until <= now())
    AND (
      sync_state.last_sync_at IS NULL
      OR sync_state.last_sync_at <= now() - make_interval(secs => p_interval_seconds)
    );

  GET DIAGNOSTICS acquired = ROW_COUNT;
  RETURN acquired;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sync_lock(
  p_id text,
  p_lock_token text,
  p_success boolean,
  p_error text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  released boolean := false;
BEGIN
  UPDATE public.sync_state
  SET locked_until = NULL,
      lock_token = NULL,
      last_sync_at = CASE WHEN p_success THEN now() ELSE last_sync_at END,
      last_finished_at = now(),
      last_error = CASE WHEN p_success THEN NULL ELSE p_error END,
      updated_at = now()
  WHERE id = p_id AND lock_token = p_lock_token;

  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_sync_lock(text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_sync_lock(text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_sync_lock(text, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_sync_lock(text, text, boolean, text) TO service_role;

CREATE INDEX IF NOT EXISTS idx_sync_state_locked_until ON public.sync_state (locked_until);
