## Objetivo
3 papéis (admin, operador, cliente) + 3 planos pagos (Start/Pro/Elite) via Stripe. Todo novo usuário entra como **cliente** e só acessa o que o plano dele libera (conforme a tabela comparativa).

## Papéis
- **Cliente** (padrão no signup): gera/edita os próprios bilhetes, limitado ao plano.
- **Operador**: tudo do cliente + edita cadastro/plano dos clientes.
- **Admin**: tudo do operador + painel de chaves de API do sistema.

## Banco (migration)
1. Enum `app_role` = admin/operador/cliente + `user_roles` + `has_role()` (security-definer) + RLS.
2. `profiles` (nome, email) auto-criado no signup; papel padrão cliente.
3. `subscriptions` (user_id, plano start/pro/elite, status, stripe ids, periodo_fim) = plano ativo.
4. GRANTs + RLS (cliente vê o próprio; operador/admin veem todos).

## Planos — matriz de acesso (da imagem)
- **Start**: bilhetes ilimitados, odd personalizada, Brasileirão A e B, Premier League, histórico 15 dias.
- **Pro**: tudo do Start + Copa do Brasil, Libertadores, Sul-Americana, La Liga, Serie A, Bundesliga, Ligue 1, Champions, Europa, Conference, Copa do Mundo, planilha de banca, favoritos, estatísticas avançadas, histórico 30 dias.
- **Elite**: tudo do Pro + tempo real, alertas inteligentes, suporte prioritário, histórico 60 dias.

Mapa central de features (ligas, dias de histórico, favoritos, etc) — checado no front e **validado no backend** antes de gerar bilhete. Quem não tem plano ativo não gera.

## Pagamento (Stripe)
- Habilitar Lovable Payments (Stripe, imposto calc/coleta +0,5%).
- 3 produtos mensais: Start R$29,90 / Pro R$49,90 / Elite R$79,90.
- Checkout + webhook grava em `subscriptions`.

## Telas
- **/auth**: signup → redireciona para /planos.
- **/planos**: cards + comparativo + assinar (checkout).
- **/_authenticated/** (cliente): gerador atual com features liberadas pelo plano; ligas/recursos bloqueados aparecem travados.
- **/_authenticated/admin/usuarios** (operador+admin): lista/edita clientes e planos.
- **/_authenticated/admin/apis** (só admin): editar chaves de API.
- Gate por papel via `has_role` no beforeLoad das rotas admin.

## Ordem
1. Migration. 2. Stripe + produtos. 3. Server fns (roles, subscription, checkout, webhook). 4. Telas planos/admin. 5. Gating por plano no gerador.

## Nota técnica
Painel de APIs do admin grava em tabela de config editável; backend lê dela com fallback nos secrets.
