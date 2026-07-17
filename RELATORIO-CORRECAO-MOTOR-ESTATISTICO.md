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

## Bloco 2 — Concorrência de cron, duplicidade de API e cache por bookmaker

### Correções aplicadas
- Criado `src/lib/sync-lock.server.ts` com aquisição/liberação atômica de locks via Postgres.
- Criada migration `20260717194500_atomic_sync_locks.sql`:
  - adiciona `locked_until`, `lock_token`, `last_error` e `last_finished_at` em `sync_state`;
  - cria as RPCs seguras `acquire_sync_lock` e `release_sync_lock`;
  - impede que duas instâncias executem o mesmo cron simultaneamente;
  - locks abandonados expiram automaticamente por TTL.
- `sync-football` e `sync-odds-diario` agora compartilham o mesmo lock atômico `football_semana`, eliminando a corrida que existia no fluxo `SELECT → UPSERT`.
- O cron rápido usa lock separado (`football`) com intervalo de 5 minutos e TTL de 8 minutos.
- A pré-análise ganhou lock `pre_analise`, evitando duas varreduras e duas coletas de estatísticas em paralelo.
- Erros, chave inválida e limite diário liberam o lock corretamente e registram a falha.
- O limite de estatísticas por execução passou a ser configurável por `MAX_STATS_PER_RUN` (padrão 6, mínimo 1, máximo 20).
- A fila de estatísticas remove IDs duplicados antes de consultar/gravar.
- A pré-análise agora cria candidatos por **partida + bookmaker**, não apenas uma análise por jogo.
- O cache deixou de reutilizar análise de outra casa. Cada bookmaker mantém sua própria chave `(partida_id, dia, casa)`.
- Comentários antigos de “odds consenso” foram removidos do caminho de leitura de cache.

### Instalação e validação
- `package-lock.json` foi regenerado e sincronizado com `package.json` por `npm install`.
- `npm audit`: 0 vulnerabilidades.
- `npx tsc --noEmit`: aprovado.
- `npm run build`: aprovado.

### Avisos restantes
- O build ainda mostra avisos de depreciação de `createServerFn().inputValidator()`. Eles não quebram a compilação, mas devem ser migrados gradualmente para `.validator()`.
- A migration de lock precisa ser aplicada no Supabase antes do deploy do novo código.
