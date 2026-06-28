UPDATE public.deep_links
SET url_template = 'https://www.google.com/search?q=' ||
  regexp_replace(lower(casa), '[^a-z0-9]+', '', 'g') || '%20{jogo}'
WHERE mercado IS NULL;

INSERT INTO public.deep_links (casa, mercado, url_template)
SELECT c.casa, NULL,
  'https://www.google.com/search?q=' || regexp_replace(lower(c.casa), '[^a-z0-9]+', '', 'g') || '%20{jogo}'
FROM (VALUES ('Bet365'),('Betano'),('Superbet'),('KTO'),('Sportingbet'),('Betfair')) AS c(casa)
WHERE NOT EXISTS (
  SELECT 1 FROM public.deep_links d WHERE lower(d.casa) = lower(c.casa) AND d.mercado IS NULL
);