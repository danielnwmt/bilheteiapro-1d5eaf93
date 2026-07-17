# Profissionalização do BilheteIA Pro

## Segurança
- Arquivos `.env` reais removidos do pacote e bloqueados no Git.
- Criado `.env.example` sem credenciais.
- Senhas e segredos padrão inseguros removidos do Docker Compose.
- O deploy agora exige `ADMIN_PASSWORD`, `JWT_SECRET`, `POSTGRES_PASSWORD` e `CRON_SECRET` explícitos.

## Operação
- Adicionados scripts `typecheck`, `check` e `start`.
- Criado `.dockerignore` para builds menores e sem vazamento de segredos.
- Servidor com health checks, cabeçalhos de segurança, limite de corpo, request ID e desligamento gracioso.

## Produto
- Textos antigos que diziam “IA” no agendador foram substituídos por “motor estatístico”.

## Antes de publicar
1. Copie `.env.example` para um arquivo de ambiente no servidor.
2. Use segredos aleatórios e fortes.
3. Aplique as migrations pendentes no Supabase.
4. Execute `npm run check`.
5. Teste `/health` e `/ready` após subir o container.
