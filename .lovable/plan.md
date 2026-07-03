# Suporte Profissional — BilheteiaPro

Objetivo: evoluir o suporte atual (chat cliente + fluxo/chatbot + ouvidoria) para um sistema completo estilo Intercom/Zendesk, **em tempo real**, mantendo layout, tema e todas as funcionalidades atuais.

Como é muito grande, entrego em **fases**. Cada fase é utilizável sozinha e não quebra as anteriores. Você aprova, eu construo a fase, valido, seguimos.

## Ponto de partida (o que já existe)
- `suporte_mensagens`, `suporte_status`, `reclamacoes` (ouvidoria) com RLS.
- `SuporteChat.tsx` (cliente) com botão Iniciar, fluxo/menu e modo reclamação.
- `FluxoBuilder.tsx` (construtor visual de blocos) + painel admin de suporte e ouvidoria.
- Server fns em `suporte.functions.ts` (lista de conversas + métricas).

Isso tudo é preservado e migrado para a nova estrutura.

## Banco de dados (novo modelo, feito por migrations)
```text
suporte_conversas   id, user_id, atendente_id, status, tags[], criado_em, atualizado_em
suporte_mensagens   +conversa_id, tipo(text/arquivo), arquivo_url, lida  (mantém colunas atuais)
chatbot_fluxo       id, nome, json, ativo
chatbot_logs        id, user_id, conversa_id, evento, detalhes, created_at
avaliacoes          id, conversa_id, nota, comentario, created_at
respostas_rapidas   id, atalho, texto
suporte_config      horários de atendimento, mensagem offline
reclamacoes         (mantida, + arquivada)
```
- RLS: cliente vê só as próprias conversas/mensagens; atendente vê as suas; supervisor/admin veem tudo.
- Novo papel `supervisor` no enum `app_role` + policies via `has_role()`.
- Storage: bucket privado `suporte-anexos` com policies por dono/atendente.
- Realtime habilitado em conversas, mensagens, status, avaliações.

## Fase 1 — Fundação de dados e conversas
- Migrations do modelo acima + migração dos dados atuais (mensagens soltas → conversa por usuário).
- Papel `supervisor`. Bucket de anexos.
- Server fns/CRUD de conversas e mensagens ligadas a `conversa_id`.

## Fase 2 — Chatbot configurável (fluxo salvo no banco)
- `FluxoBuilder` passa a salvar/carregar de `chatbot_fluxo` (adicionar, remover, mover, editar, conectar, salvar, ativar).
- Retorno ao menu e "⬅ Voltar ao Menu" no cliente.

## Fase 3 — Fluxo do cliente + Falar com atendente + Ouvidoria
- Tela inicial "Como podemos ajudar?" + Iniciar; menu com os 8 itens.
- "Falar com atendente" cria conversa e injeta o **histórico do chatbot** (opções escolhidas, respostas automáticas, horários) para o atendente ver.
- Ouvidoria continua separada (não abre conversa), registro em `reclamacoes`.
- Logs de eventos (entrou, escolheu opção, iniciou atendimento, etc.).

## Fase 4 — Console do atendente (tempo real)
- Lista/fila de conversas com status colorido (Aberto, Aguardando Atendente, Em Atendimento, Aguardando Cliente, Finalizado).
- Assumir atendimento (trava para outros atendentes, mostra nome).
- Indicador de digitação (Realtime presence/broadcast).
- Confirmação de leitura ✓ / ✓✓ / ✓✓ lida.
- Upload de arquivos (imagem, PDF, vídeo curto) com preview no Storage.
- Respostas rápidas com `/atalho`. Tags. Finalizar + avaliação por estrelas.

## Fase 5 — Filtros, busca, histórico, fila
- Busca por nome/ID/email/telefone/data/status/tag.
- Filtros: hoje, ontem, 7d, 30d, finalizados, em atendimento, aguardando.
- Histórico de atendimentos (cliente e atendente).
- Fila com posição e tempo estimado. Horário de atendimento + mensagem offline.

## Fase 6 — Dashboard, permissões, notificações
- Dashboard: atendimentos hoje/ativos, tempo médio de resposta e atendimento, aguardando, finalizados, reclamações abertas/resolvidas, avaliação média.
- Permissões: Administrador (total), Supervisor (vê tudo), Atendente (só as suas).
- Notificações em tempo real: badge vermelho + som opcional.

## Detalhes técnicos
- Stack: TanStack Start + `createServerFn` (lógica interna), Supabase Realtime, Storage, RLS, TanStack Query.
- Reuso de componentes shadcn já no projeto; nada de mudança no design global.
- Presence/broadcast do Supabase para digitação e notificações.
- Código modular: hooks (`useConversas`, `useMensagens`, `useTyping`), componentes reutilizáveis, sem duplicação.
- Ao fim de cada fase: typecheck + verificação de que o fluxo antigo continua funcionando.

## Confirmações que preciso de você
1. Começo pela **Fase 1** (banco + migração de dados) agora?
2. Som de notificação: pode ser um beep simples embutido? (sem upload de áudio externo)
3. Vídeo no upload: limito a ~20MB por causa do limite de arquivos?
