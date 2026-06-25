-- Hide raw Stripe identifiers from the user-facing Data API.
-- Only the service-role (server-side) keeps access to these columns.
REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.subscriptions FROM authenticated;
REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.subscriptions FROM anon;