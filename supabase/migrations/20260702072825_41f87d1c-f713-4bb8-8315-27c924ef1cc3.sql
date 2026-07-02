REVOKE EXECUTE ON FUNCTION public.limpar_dados_antigos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_dados_antigos() TO postgres, service_role;