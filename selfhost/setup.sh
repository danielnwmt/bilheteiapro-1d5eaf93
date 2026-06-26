#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  BilheteIA PRO — Instalação 100% LOCAL na VPS
#  Sobe Postgres + Auth + Data API (Supabase self-hosted) + o App.
#  Uso:   cd selfhost && bash setup.sh
# ============================================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE="$SCRIPT_DIR/.env"

# Detecta (e instala, se preciso) o Docker + Compose
ensure_docker() {
  if docker compose version >/dev/null 2>&1; then DC="docker compose"; return; fi
  if command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"; return; fi

  echo ">> Docker não encontrado. Instalando automaticamente..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    curl -fsSL https://get.docker.com | sh
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y dnf-plugins-core || true
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif command -v yum >/dev/null 2>&1; then
    yum install -y yum-utils || true
    yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
    yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    curl -fsSL https://get.docker.com | sh
  fi

  systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true

  if docker compose version >/dev/null 2>&1; then DC="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
  else
    echo "ERRO: Falha ao instalar o Docker/Compose automaticamente. Instale manualmente e rode de novo."
    exit 1
  fi
  echo ">> Docker instalado com sucesso."
}
ensure_docker

# ---------- Helpers para gerar JWT (anon / service_role) com openssl ----------
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
make_jwt() {
  local role="$1" secret="$2"
  local now exp header payload h p sig
  now=$(date +%s); exp=$((now + 60*60*24*365*10))
  header='{"alg":"HS256","typ":"JWT"}'
  payload="{\"role\":\"$role\",\"iss\":\"supabase\",\"iat\":$now,\"exp\":$exp}"
  h=$(printf '%s' "$header"  | b64)
  p=$(printf '%s' "$payload" | b64)
  sig=$(printf '%s' "$h.$p" | openssl dgst -binary -sha256 -hmac "$secret" | b64)
  echo "$h.$p.$sig"
}
rand() { openssl rand -hex "${1:-24}"; }

# ---------- 1) Gera/garante o .env (somente na 1ª vez) ----------
if [ ! -f "$ENV_FILE" ]; then
  echo ">> Primeira instalação — gerando chaves locais..."

  # IP/host público para o navegador acessar a API de auth/dados
  DEFAULT_HOST="$(curl -s --max-time 4 ifconfig.me || true)"
  read -rp "Domínio ou IP público desta VPS [${DEFAULT_HOST:-seu-ip}]: " PUBHOST
  PUBHOST="${PUBHOST:-$DEFAULT_HOST}"
  read -rp "Porta da API Supabase [8000]: " SUPABASE_PORT; SUPABASE_PORT="${SUPABASE_PORT:-8000}"
  read -rp "Porta do App [3000]: " APP_PORT; APP_PORT="${APP_PORT:-3000}"
  read -rp "Email do admin [contato@protenexus.com]: " ADMIN_EMAIL; ADMIN_EMAIL="${ADMIN_EMAIL:-contato@protenexus.com}"
  read -rp "Senha do admin [admin.1234]: " ADMIN_PASSWORD; ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin.1234}"

  JWT_SECRET="$(rand 32)"
  POSTGRES_PASSWORD="$(rand 16)"
  INGEST_SECRET="$(rand 24)"
  ANON_KEY="$(make_jwt anon "$JWT_SECRET")"
  SERVICE_ROLE_KEY="$(make_jwt service_role "$JWT_SECRET")"
  SUPABASE_PUBLIC_URL="http://${PUBHOST}:${SUPABASE_PORT}"

  cat > "$ENV_FILE" <<EOF
# ===== Gerado automaticamente por setup.sh — NÃO compartilhar =====
SUPABASE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}
SITE_URL=http://${PUBHOST}:${APP_PORT}
SUPABASE_PORT=${SUPABASE_PORT}
APP_PORT=${APP_PORT}

JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
INGEST_SECRET=${INGEST_SECRET}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
  chmod 600 "$ENV_FILE"
  echo ">> .env criado."
else
  echo ">> Usando .env existente."
fi

# Carrega variáveis
set -a; . "$ENV_FILE"; set +a

PSQL=( $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres )

# ---------- 2) Sobe banco + auth (auth cria o schema auth.users) ----------
echo ">> Subindo banco de dados..."
$DC up -d db
echo ">> Aguardando banco..."
until $DC exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done

echo ">> Subindo Auth (cria o schema de usuários)..."
$DC up -d auth

echo ">> Aguardando o schema auth.users..."
until "${PSQL[@]}" -tAc "SELECT to_regclass('auth.users') IS NOT NULL" 2>/dev/null | grep -q t; do sleep 2; done

# ---------- 3) Aplica pré-requisitos + schema do app + cria admin ----------
echo ">> Aplicando pré-requisitos (roles/funções)..."
$DC cp pre.sql db:/tmp/pre.sql
"${PSQL[@]}" -f /tmp/pre.sql >/dev/null

echo ">> Aplicando schema do aplicativo..."
$DC cp schema.sql db:/tmp/schema.sql
if "${PSQL[@]}" -tAc "SELECT to_regclass('public.profiles') IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL" 2>/dev/null | grep -q t; then
  echo ">> Schema principal já existe; pulando criação das tabelas."
else
  "${PSQL[@]}" -f /tmp/schema.sql >/dev/null
fi

# ---------- 4) Sobe Data API + gateway (necessários para a API do Auth) ----------
echo ">> Subindo Data API e gateway..."
$DC up -d rest kong

# ---------- 5) Cria/garante o admin via API oficial do Auth ----------
echo ">> Criando/garantindo o admin..."
bash "$SCRIPT_DIR/create-admin.sh"

# ---------- 6) Sobe o app (build) ----------
echo ">> Subindo o aplicativo (build)..."
$DC up -d --build app

echo ""
echo "============================================================"
echo " Instalação local concluída!"
echo " App:        http://$(echo "$SITE_URL" | sed 's#http://##')"
echo " Supabase:   ${SUPABASE_PUBLIC_URL}"
echo " Admin:      ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
echo "------------------------------------------------------------"
echo " Libere no firewall as portas ${SUPABASE_PORT} (API) e ${APP_PORT} (App)."
echo "============================================================"
