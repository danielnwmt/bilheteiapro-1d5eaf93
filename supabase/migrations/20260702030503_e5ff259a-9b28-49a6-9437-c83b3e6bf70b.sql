-- As tabelas de leitura pública não tinham permissão de leitura para os
-- papéis da aplicação (anon/authenticated), então o navegador recebia vazio
-- mesmo com dados coletados. Concede leitura para exibir as estatísticas.
GRANT SELECT ON public.estatisticas TO anon, authenticated;
GRANT SELECT ON public.analise_cache TO anon, authenticated;
GRANT SELECT ON public.partidas TO anon, authenticated;
GRANT SELECT ON public.odds TO anon, authenticated;