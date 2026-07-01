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
AUTO_INSTALL="${AUTO_INSTALL:-0}"

# Detecta (e instala, se preciso) o Docker + Compose
ensure_docker() {
  if docker compose version >/dev/null 2>&1; then
    DC="docker compose"
    systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
    systemctl enable --now docker 2>/dev/null || service docker start 2>/dev/null || true
    return
  fi

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

prompt_value() {
  local __var="$1" label="$2" default="$3" value=""
  if [ "$AUTO_INSTALL" = "1" ] || [ ! -t 0 ]; then
    value="$default"
    echo ">> ${label}: ${value:-padrao}"
  else
    read -rp "${label} [${default}]: " value
    value="${value:-$default}"
  fi
  printf -v "$__var" '%s' "$value"
}

env_has_value() {
  local key="$1"
  grep -Eq "^${key}=.+" "$ENV_FILE" 2>/dev/null
}

# ---------- 1) Gera/garante o .env (somente na 1ª vez) ----------
if [ ! -f "$ENV_FILE" ]; then
  echo ">> Primeira instalação — gerando chaves locais..."

  # IP público para o navegador acessar a API de auth/dados.
  # Tenta IPv4 primeiro; se não houver, cai para IPv6.
  detect_ipv4() {
    local ip=""
    for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://ipv4.icanhazip.com" "https://checkip.amazonaws.com"; do
      ip="$(curl -4 -s --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]')"
      if printf '%s' "$ip" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        printf '%s' "$ip"; return 0
      fi
    done
    return 1
  }
  detect_ipv6() {
    local ip=""
    for url in "https://api6.ipify.org" "https://ifconfig.co/ip" "https://ipv6.icanhazip.com"; do
      ip="$(curl -6 -s --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]')"
      if printf '%s' "$ip" | grep -Eq '^[0-9a-fA-F:]+:[0-9a-fA-F:]+$'; then
        printf '%s' "$ip"; return 0
      fi
    done
    return 1
  }
  DEFAULT_HOST="$(detect_ipv4 || true)"
  if [ -z "$DEFAULT_HOST" ]; then
    IPV6="$(detect_ipv6 || true)"
    # Em URL, IPv6 precisa ficar entre colchetes: http://[::1]:8000
    [ -n "$IPV6" ] && DEFAULT_HOST="[${IPV6}]"
  fi
  DEFAULT_HOST="${DEFAULT_HOST:-127.0.0.1}"
  prompt_value PUBHOST "Domínio (ex: app.seudominio.com) ou IP público desta VPS" "$DEFAULT_HOST"

  prompt_value SUPABASE_PORT "Porta da API local" "8000"
  prompt_value AUTH_PORT "Porta interna do Auth" "9999"
  prompt_value APP_PORT "Porta do App" "3000"
  prompt_value ADMIN_EMAIL "Email do admin" "contato@protenexus.com"
  prompt_value ADMIN_PASSWORD "Senha do admin" "admin.1234"

  JWT_SECRET="$(rand 32)"
  POSTGRES_PASSWORD="$(rand 16)"
  INGEST_SECRET="$(rand 24)"
  CRON_SECRET="$(rand 32)"
  ANON_KEY="$(make_jwt anon "$JWT_SECRET")"
  SERVICE_ROLE_KEY="$(make_jwt service_role "$JWT_SECRET")"
  SUPABASE_PUBLIC_URL="http://${PUBHOST}:${SUPABASE_PORT}"

  cat > "$ENV_FILE" <<EOF
# ===== Gerado automaticamente por setup.sh — NÃO compartilhar =====
SUPABASE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}
SITE_URL=http://${PUBHOST}:${APP_PORT}
SUPABASE_PORT=${SUPABASE_PORT}
AUTH_PORT=${AUTH_PORT}
APP_PORT=${APP_PORT}

JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
INGEST_SECRET=${INGEST_SECRET}
CRON_SECRET=${CRON_SECRET}

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

# Repara .env antigo/incompleto sem pedir dados durante atualizações.
if ! env_has_value JWT_SECRET; then save_later_jwt="$(rand 32)"; echo "JWT_SECRET=${save_later_jwt}" >> "$ENV_FILE"; fi
set -a; . "$ENV_FILE"; set +a
if ! env_has_value POSTGRES_PASSWORD; then echo "POSTGRES_PASSWORD=$(rand 16)" >> "$ENV_FILE"; fi
if ! env_has_value INGEST_SECRET; then echo "INGEST_SECRET=$(rand 24)" >> "$ENV_FILE"; fi
if ! env_has_value ADMIN_EMAIL; then echo "ADMIN_EMAIL=contato@protenexus.com" >> "$ENV_FILE"; fi
if ! env_has_value ADMIN_PASSWORD; then echo "ADMIN_PASSWORD=admin.1234" >> "$ENV_FILE"; fi
if ! env_has_value SUPABASE_PORT; then echo "SUPABASE_PORT=8000" >> "$ENV_FILE"; fi
if ! env_has_value AUTH_PORT; then echo "AUTH_PORT=9999" >> "$ENV_FILE"; fi
if ! env_has_value APP_PORT; then echo "APP_PORT=3000" >> "$ENV_FILE"; fi
set -a; . "$ENV_FILE"; set +a
if ! env_has_value SUPABASE_PUBLIC_URL; then echo "SUPABASE_PUBLIC_URL=http://127.0.0.1:${SUPABASE_PORT:-8000}" >> "$ENV_FILE"; fi
if ! env_has_value SITE_URL; then echo "SITE_URL=http://127.0.0.1:${APP_PORT:-3000}" >> "$ENV_FILE"; fi
if ! env_has_value ANON_KEY; then echo "ANON_KEY=$(make_jwt anon "$JWT_SECRET")" >> "$ENV_FILE"; fi
if ! env_has_value SERVICE_ROLE_KEY; then echo "SERVICE_ROLE_KEY=$(make_jwt service_role "$JWT_SECRET")" >> "$ENV_FILE"; fi
chmod 600 "$ENV_FILE"
set -a; . "$ENV_FILE"; set +a

PSQL=( $DC exec -T db psql -v ON_ERROR_STOP=1 -v postgres_password="$POSTGRES_PASSWORD" -U postgres -d postgres )

reset_runtime_services() {
  # Recria containers/rede para não guardar IP antigo do banco.
  # O volume do banco NÃO é removido.
  echo ">> Reiniciando rede local dos containers..."
  $DC down --remove-orphans >/dev/null 2>&1 || true
}

save_env_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"
  else
    return 1
  fi
}

stop_docker_containers_on_port() {
  local port="$1"
  local ids names
  ids="$(docker ps --filter "publish=${port}" -q 2>/dev/null || true)"
  [ -z "$ids" ] && return 0

  names="$(docker ps --filter "publish=${port}" --format '{{.Names}}' 2>/dev/null | paste -sd ', ' -)"
  echo ">> Porta ${port} ocupada por container Docker (${names}). Parando para liberar..."
  # shellcheck disable=SC2086
  docker rm -f $ids >/dev/null 2>&1 || true

  for _ in $(seq 1 10); do
    docker ps --filter "publish=${port}" -q 2>/dev/null | grep -q . || return 0
    sleep 1
  done
}

ensure_app_port_available() {
  APP_PORT="${APP_PORT:-3000}"
  SITE_URL="${SITE_URL:-http://localhost:${APP_PORT}}"

  stop_docker_containers_on_port "$APP_PORT"

  if port_is_listening "$APP_PORT"; then
    local old_port="$APP_PORT" candidate base_url
    echo ">> Porta ${old_port} ainda ocupada por outro processo. Procurando porta livre..."
    for candidate in $(seq $((old_port + 1)) $((old_port + 30))); do
      if ! port_is_listening "$candidate" && [ -z "$(docker ps --filter "publish=${candidate}" -q 2>/dev/null || true)" ]; then
        APP_PORT="$candidate"
        base_url="${SITE_URL%:*}"
        SITE_URL="${base_url}:${APP_PORT}"
        save_env_value APP_PORT "$APP_PORT"
        save_env_value SITE_URL "$SITE_URL"
        set -a; . "$ENV_FILE"; set +a
        echo ">> Usando porta livre para o app: ${APP_PORT}"
        return 0
      fi
    done

    echo "ERRO: não encontrei porta livre para o app. Libere a porta ${old_port} e rode novamente."
    exit 1
  fi
}

ensure_supabase_port_available() {
  SUPABASE_PORT="${SUPABASE_PORT:-8000}"
  SUPABASE_PUBLIC_URL="${SUPABASE_PUBLIC_URL:-http://localhost:${SUPABASE_PORT}}"

  stop_docker_containers_on_port "$SUPABASE_PORT"

  if port_is_listening "$SUPABASE_PORT"; then
    local old_port="$SUPABASE_PORT" candidate base_url
    echo ">> Porta ${old_port} da API local ocupada por outro processo. Procurando porta livre..."
    for candidate in $(seq $((old_port + 1)) $((old_port + 30))); do
      if ! port_is_listening "$candidate" && [ -z "$(docker ps --filter "publish=${candidate}" -q 2>/dev/null || true)" ]; then
        SUPABASE_PORT="$candidate"
        base_url="${SUPABASE_PUBLIC_URL%:*}"
        SUPABASE_PUBLIC_URL="${base_url}:${SUPABASE_PORT}"
        save_env_value SUPABASE_PORT "$SUPABASE_PORT"
        save_env_value SUPABASE_PUBLIC_URL "$SUPABASE_PUBLIC_URL"
        set -a; . "$ENV_FILE"; set +a
        echo ">> Usando porta livre para a API local: ${SUPABASE_PORT}"
        return 0
      fi
    done

    echo "ERRO: não encontrei porta livre para a API local. Libere a porta ${old_port} e rode novamente."
    exit 1
  fi
}

ensure_supabase_port_available

ensure_auth_port_available() {
  AUTH_PORT="${AUTH_PORT:-9999}"
  stop_docker_containers_on_port "$AUTH_PORT"

  if port_is_listening "$AUTH_PORT"; then
    local old_port="$AUTH_PORT" candidate
    echo ">> Porta ${old_port} do Auth local ocupada. Procurando porta livre..."
    for candidate in $(seq $((old_port + 1)) $((old_port + 30))); do
      if ! port_is_listening "$candidate" && [ -z "$(docker ps --filter "publish=${candidate}" -q 2>/dev/null || true)" ]; then
        AUTH_PORT="$candidate"
        save_env_value AUTH_PORT "$AUTH_PORT"
        set -a; . "$ENV_FILE"; set +a
        echo ">> Usando porta livre para o Auth local: ${AUTH_PORT}"
        return 0
      fi
    done

    echo "ERRO: não encontrei porta livre para o Auth local. Libere a porta ${old_port} e rode novamente."
    exit 1
  fi
}

ensure_auth_port_available

# Em atualizações/reinstalações, containers antigos podem ficar apontando para
# um IP antigo do Postgres e o Auth trava com "dial tcp ... connect: refused".
reset_runtime_services

# ---------- 2) Sobe banco + auth (auth cria o schema auth.users) ----------
echo ">> Subindo banco de dados..."
$DC up -d --force-recreate db
echo ">> Aguardando banco..."
until $DC exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 2; done

echo ">> Preparando banco local para autenticação..."
$DC cp pre.sql db:/tmp/pre.sql
"${PSQL[@]}" -f /tmp/pre.sql >/dev/null

wait_for_auth_users() {
  local attempts="${1:-60}" i
  for i in $(seq 1 "$attempts"); do
    if "${PSQL[@]}" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users')" 2>/dev/null | grep -q t; then
      return 0
    fi
    if [ $((i % 10)) -eq 0 ]; then
      echo ">> Auth ainda criando schema auth.users... ($i/$attempts)"
      $DC logs --tail=20 auth || true
    fi
    sleep 2
  done
  return 1
}

wait_for_auth_schema_ready() {
  local attempts="${1:-60}" i
  for i in $(seq 1 "$attempts"); do
    if "${PSQL[@]}" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users') AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='identities')" 2>/dev/null | grep -q t; then
      return 0
    fi
    if [ $((i % 10)) -eq 0 ]; then
      echo ">> Auth ainda criando schema completo auth.users/auth.identities... ($i/$attempts)"
      $DC logs --tail=20 auth || true
    fi
    sleep 2
  done
  return 1
}

echo ">> Subindo Auth (cria o schema de usuários)..."
$DC up -d --force-recreate auth

echo ">> Aguardando o schema auth.users..."
if ! wait_for_auth_users 60; then
  echo "ATENÇÃO: Auth travou antes de criar auth.users. Limpando schema auth incompleto e tentando novamente..."
  echo ">> Últimas linhas do Auth antes do reparo:"
  $DC logs --tail=100 auth || true
  $DC stop auth >/dev/null 2>&1 || true
  "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;" >/dev/null
  $DC up -d --force-recreate auth

  if ! wait_for_auth_users 60; then
    echo "ERRO: Auth não conseguiu criar auth.users. Veja o erro real abaixo:"
    $DC logs --tail=160 auth || true
    exit 1
  fi
fi

echo ">> Aguardando schema completo do Auth..."
if ! wait_for_auth_schema_ready 60; then
  echo "ATENÇÃO: Auth não criou auth.identities. Limpando schema auth incompleto e tentando novamente..."
  echo ">> Últimas linhas do Auth antes do reparo:"
  $DC logs --tail=100 auth || true
  $DC stop auth >/dev/null 2>&1 || true
  "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;" >/dev/null
  $DC cp pre.sql db:/tmp/pre.sql
  "${PSQL[@]}" -f /tmp/pre.sql >/dev/null
  $DC up -d --force-recreate auth

  if ! wait_for_auth_schema_ready 60; then
    echo "ERRO: Auth não conseguiu criar auth.users/auth.identities. Veja o erro real abaixo:"
    $DC logs --tail=160 auth || true
    exit 1
  fi
fi

# ---------- 3) Aplica pré-requisitos + schema do app + cria admin ----------
echo ">> Aplicando pré-requisitos (roles/funções)..."
$DC cp pre.sql db:/tmp/pre.sql
"${PSQL[@]}" -f /tmp/pre.sql >/dev/null

echo ">> Aplicando schema do aplicativo..."
$DC cp schema.sql db:/tmp/schema.sql
if "${PSQL[@]}" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles')" 2>/dev/null | grep -q t; then
  echo ">> Schema principal já existe; pulando criação das tabelas."
else
  if "${PSQL[@]}" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('partidas','odds','bilhetes','profiles','user_roles','subscriptions'))" 2>/dev/null | grep -q t; then
    echo ">> Schema parcial/incompleto detectado. Recriando schema public para uma instalação limpa..."
    "${PSQL[@]}" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;" >/dev/null
    "${PSQL[@]}" -f /tmp/pre.sql >/dev/null
  fi
  "${PSQL[@]}" -f /tmp/schema.sql >/dev/null
fi

echo ">> Reparando schema local e listagem de usuários..."
$DC cp repair.sql db:/tmp/repair.sql
"${PSQL[@]}" -f /tmp/repair.sql >/dev/null

# ---------- 4) Sobe Data API + gateway (necessários para a API do Auth) ----------
echo ">> Subindo Data API e gateway..."
$DC up -d rest kong

echo ">> Aguardando Auth local responder..."
AUTH_READY=0
# A checagem é feita DENTRO da rede do Docker (wget do próprio container do
# Auth). Isso evita falsos "indisponível" quando o host não tem curl, quando a
# porta só escuta em IPv6/loopback diferente, ou quando o GoTrue ainda está
# rodando as migrações da primeira inicialização.
for i in $(seq 1 45); do
  if $DC exec -T auth wget -q -O /dev/null --spider "http://127.0.0.1:9999/health" 2>/dev/null; then
    AUTH_READY=1
    break
  fi
  # fallback: tenta pela porta publicada no host (curl), se existir
  if command -v curl >/dev/null 2>&1; then
    HC="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${AUTH_PORT:-9999}/health" 2>/dev/null || printf '000')"
    if [ "$HC" = "200" ] || [ "$HC" = "204" ]; then AUTH_READY=1; break; fi
  fi
  echo ">> Auth local ainda subindo (tentativa $i/45)..."
  sleep 2
done
if [ "$AUTH_READY" != "1" ]; then
  echo "ATENÇÃO: Auth não respondeu a tempo; seguindo com criação do admin via SQL local."
  echo ">> Últimas linhas do Auth:"
  $DC logs --tail=80 auth || true
fi

# ---------- 5) Cria/garante o admin via API oficial do Auth ----------
echo ">> Criando/garantindo o admin..."
bash "$SCRIPT_DIR/create-admin.sh"

# ---------- 6) Sobe o app (build) ----------
echo ">> Subindo o aplicativo (build)..."
ensure_app_port_available
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
