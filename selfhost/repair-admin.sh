#!/usr/bin/env bash
set -euo pipefail

# Repara/cria o admin padrão no self-host, independente da pasta atual.
# Uso: bash /opt/lovable/app/selfhost/repair-admin.sh

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERRO: Docker/Docker Compose não encontrado."
  exit 1
fi

if [ ! -f .env ]; then
  echo "ERRO: .env não encontrado em $SCRIPT_DIR. Rode primeiro: bash setup.sh"
  exit 1
fi

set -a; . ./.env; set +a

ADMIN_EMAIL="${ADMIN_EMAIL:-contato@protenexus.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin.1234}"

echo ">> Garantindo banco/auth/gateway no ar..."
$DC up -d db auth rest kong
until $DC exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done

echo ">> Recriando/garantindo admin padrão via API do Auth..."
bash "$SCRIPT_DIR/create-admin.sh"

echo ">> Reiniciando app..."
$DC up -d --build app

echo "Admin pronto: $ADMIN_EMAIL / $ADMIN_PASSWORD"