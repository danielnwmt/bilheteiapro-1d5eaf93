REVOKE EXECUTE ON FUNCTION public.increment_api_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_api_usage(text) TO service_role;