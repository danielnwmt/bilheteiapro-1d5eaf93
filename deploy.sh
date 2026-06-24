#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Deploy automático do BilheteIA na VPS
#  Uso:  bash deploy.sh
#  Faz tudo sozinho: pull, build, e sobe o container com restart automático.
# ============================================================

APP_DIR="$HOME/app"
ENV_FILE="$APP_DIR/.env"
IMAGE="lovable-app"
CONTAINER="lovable-app"
PORT="3000"

cd "$APP_DIR"

# 1) Garante o arquivo .env com as chaves secretas (pede só na 1a vez)
#    GEMINI_API_KEY: pegue em https://aistudio.google.com/apikey
need_keys=(GEMINI_API_KEY API_FOOTBALL_KEY FIRECRAWL_API_KEY INGEST_SECRET)

if [ ! -f "$ENV_FILE" ]; then
  echo ">> Primeira vez: cole as chaves."
  echo ">> GEMINI_API_KEY = pegue em https://aistudio.google.com/apikey"
  : > "$ENV_FILE"
  for k in "${need_keys[@]}"; do
    read -rp "$k = " v
    echo "$k=$v" >> "$ENV_FILE"
  done
  chmod 600 "$ENV_FILE"
  echo ">> .env salvo. Nas próximas vezes não vai pedir de novo."
fi

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
