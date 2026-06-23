CREATE TABLE public.sync_state (
  id TEXT PRIMARY KEY,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_state TO authenticated;
GRANT ALL ON public.sync_state TO service_role;

ALTER TABLE public.sync_state ENABLE ROW LEVEL SECURITY;

-- Sem políticas públicas: apenas service_role (cron/worker) acessa.

INSERT INTO public.sync_state (id, last_sync_at) VALUES ('football', NULL)
ON CONFLICT (id) DO NOTHING;