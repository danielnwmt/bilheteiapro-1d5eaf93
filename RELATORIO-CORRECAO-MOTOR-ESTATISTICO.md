# Relatório — Correção do Motor Estatístico

Documento vivo. Cada bloco aprovado é adicionado aqui.

## Bloco 1 — Fallback sem estatísticas + `analysis_quality` + filtros Melhores Picks
Itens do plano: **1, 2, 11**.

### Arquivos alterados
- `src/lib/analise.server.ts`
  - Novo tipo `AnalysisQuality = "complete" | "partial" | "market_only" | "unavailable"`.
  - Novo `ValorLabel` `"Leitura de mercado"`.
  - Novos campos opcionais em `PickAnalise`: `analysisQuality`, `dataQualityScore`, `calculationVersion`.
  - Exportada constante `CALCULATION_VERSION` (versão atual: `2026.07.17-b1`).
  - `normalizarAnaliseCache` deixou de **inflar** confiança de picks antigas do fallback; agora detecta essas picks e reclassifica como `market_only` com teto de 55%, EV=0, estrelas=0.
  - `montarAnaliseSemIa` (fallback de fallback) reescrito: gera picks `market_only` com confiança ≤ 55%, `evPct=0`, `valorLabel="Leitura de mercado"` e a justificativa oficial:
    > "Dados estatísticos insuficientes. Esta seleção foi baseada apenas na leitura das odds e não deve ser tratada como recomendação principal."
- `src/lib/analise-local.server.ts`
  - Import de `AnalysisQuality` e `CALCULATION_VERSION`.
  - `picksSoOdds` reescrito com a mesma regra: `market_only`, confiança ≤ 55%, sem EV/estrelas.
  - Picks reais do motor agora carregam `analysisQuality` (`complete` ≥ 75 de qualidade, `partial` abaixo) + `dataQualityScore` (0–100) + `calculationVersion`.
- `src/lib/melhores-picks.functions.ts`
  - Filtra out `analysisQuality === "market_only" | "unavailable"`.
  - Exige `evPct > 0` quando informado.
- `src/lib/entradas.functions.ts`
  - "Melhores Entradas" ignora picks `market_only`/`unavailable`.
  - Removida a lógica antiga que **inflava** confiança para 88–94% em picks de fallback.
- `src/lib/auto-bilhete.server.ts`
  - Bilhete automático e Super Múltipla não aceitam mais picks `market_only`/`unavailable`.

### Migrations
Nenhuma. Os novos campos vivem dentro do `payload jsonb` de `public.analise_cache`; nenhum DDL necessário.

### Regras de qualidade implementadas
- `market_only` → confiança máx. 55%, sem EV, sem estrelas, sem selo "Valor", excluída de: Melhores Picks, Melhores Entradas, bilhete automático, Super Múltipla.
- Picks reais recebem `dataQualityScore` = `ctx.qualidadeDados * 100` e são classificadas em `complete`/`partial`.
- Cache antigo é reclassificado no ato da leitura (não precisa purgar `analise_cache`).

### O que **não** foi feito neste bloco (fica para os próximos)
- Recalcular EV por casa (Bloco 2).
- Chave de cache incluir bookmaker/market/line/version (Bloco 2).
- Renomear `eloProxy` → `relativeStrengthIndex` (fica no Bloco 3 junto com modelo de escanteios/cartões).
- Score explícito 0–100 exposto separadamente do `dataQualityScore` (o campo já existe; documentação e ajuste fino ficam para o Bloco 4).
- `analysis_quality = "unavailable"` (dados insuficientes + odds ruins) ainda não é emitido — hoje devolve array vazio; será formalizado no Bloco 4.

### Resultado do build/typecheck
- `tsgo --noEmit`: **OK**, sem erros.
- Testes: nenhum teste novo (suite de testes é o Bloco 4).

### Backup lógico
Nenhuma função foi deletada. Comportamento antigo do fallback continua no histórico do repositório se precisar reverter.
