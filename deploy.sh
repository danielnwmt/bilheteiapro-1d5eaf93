#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Deploy automático do BilheteIA na VPS
#  Uso:  bash deploy.sh
#  Faz tudo sozinho: pull, build, e sobe o container com restart automático.
# ============================================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
IMAGE="lovable-app"
CONTAINER="lovable-app"
PORT="3000"

if [ ! -d "$APP_DIR" ]; then
  echo "ERRO: pasta do app não encontrada: $APP_DIR"
  echo "Entre na pasta onde está o deploy.sh e rode: bash deploy.sh"
  exit 1
fi

cd "$APP_DIR"

# 1) Garante o arquivo .env com as chaves necessárias (pede só o que faltar)
#    GEMINI_API_KEY: pegue em https://aistudio.google.com/apikey

# Valores fixos do backend (preenchidos automaticamente)
SUPABASE_URL_DEFAULT="https://zzjrfmiqhlwomablszdj.supabase.co"
SUPABASE_PUBLISHABLE_KEY_DEFAULT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6anJmbWlxaGx3b21hYmxzemRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzg5NDksImV4cCI6MjA5Nzc1NDk0OX0.ycHZosTLK6KClr0o0TPlVptwteEWhzc5W9Vu2uixABI"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Garante uma chave no .env: se faltar, usa o default; se não houver default, pergunta.
ensure_key() {
  local key="$1" default="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then return; fi
  if [ -n "$default" ]; then
    echo "${key}=${default}" >> "$ENV_FILE"
    echo ">> $key preenchido automaticamente."
  else
    read -rp "$key = " v
    echo "${key}=${v}" >> "$ENV_FILE"
  fi
}

echo ">> Conferindo variáveis do .env..."
ensure_key SUPABASE_URL "$SUPABASE_URL_DEFAULT"
ensure_key SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_KEY_DEFAULT"
ensure_key SUPABASE_SERVICE_ROLE_KEY ""   # cole a service role key (necessária p/ admin)
# GEMINI_API_KEY, API_FOOTBALL_KEY, ODDS_API_KEY e demais chaves de integração
# são adicionadas manualmente no painel Admin -> APIs do sistema (após instalar).
ensure_key INGEST_SECRET ""

# 2) Atualiza o código
echo ">> Atualizando código..."
git pull

# 3) Build limpo
echo ">> Buildando imagem..."
docker build --no-cache -t "$IMAGE" .

# 4) Sobe o container (reinicia sozinho se cair / reboot)
echo ">> Subindo container..."
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  --restart always \
  -p "$PORT:3000" \
  --env-file "$ENV_FILE" \
  "$IMAGE"

# 5) Checa
sleep 6
echo ">> Status:"
curl -I "http://127.0.0.1:$PORT" || true
echo ">> Pronto! App rodando na porta $PORT."
