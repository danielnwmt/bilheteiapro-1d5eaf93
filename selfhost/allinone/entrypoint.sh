#!/usr/bin/env bash
# ============================================================
# BilheteIA PRO — entrypoint TUDO-EM-UM (1 container, 1 porta)
# Sobe Postgres + GoTrue (Auth) + PostgREST (API) + app Node,
# tudo atrás de um nginx na mesma porta pública.
# ============================================================
set -euo pipefail

APP_DIR=/opt/app
SELF=/opt/app/selfhost
GOTRUE_DIR=/opt/gotrue
export PGDATA=/var/lib/postgresql/data
PGBIN=/usr/lib/postgresql/15/bin
export PATH="$PGBIN:$PATH"

LISTEN_PORT="${PORT:-3000}"
APP_INTERNAL_PORT=8080
JWT_SECRET="${JWT_SECRET:-bilheteia-localweb-default-jwt-secret-change-me-2026}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-local-postgres-password}"
ADMIN_EMAIL="${ADMIN_EMAIL:-contato@protenexus.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin.1234}"
ANON_KEY="${ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgyNDQwMDAwLCJleHAiOjIwOTc4MDAwMDB9.mX6rq28Z0cpvC22UaLwB1AZHIrjrurs5W-faJBMopsg}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODI0NDAwMDAsImV4cCI6MjA5NzgwMDAwMH0.NmDPQQ9qo1Uct2qZepO-EcrMcZNG-V3oj-PglOmMSas}"

# --- URL pública (mesma origem do app) -----------------------------
PUBLIC_URL="${SUPABASE_PUBLIC_URL:-}"
if [ -z "$PUBLIC_URL" ]; then
  IP=$(wget -qO- --timeout=4 https://ifconfig.me 2>/dev/null || true)
  PUBLIC_URL="http://${IP:-localhost}:${LISTEN_PORT}"
fi
echo ">> PUBLIC_URL = $PUBLIC_URL"

# --- Postgres ------------------------------------------------------
mkdir -p "$PGDATA"
chown -R postgres:postgres /var/lib/postgresql
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo ">> Inicializando banco de dados local..."
  su postgres -c "$PGBIN/initdb -D '$PGDATA' --auth=trust --encoding=UTF8 -U postgres"
  echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
fi
echo ">> Subindo Postgres..."
su postgres -c "$PGBIN/pg_ctl -D '$PGDATA' -o '-c listen_addresses=127.0.0.1 -p 5432' -w -t 60 start"

export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
until pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done

echo ">> Aplicando pré-requisitos (roles, schemas, extensões)..."
psql -v ON_ERROR_STOP=1 -v postgres_password="$POSTGRES_PASSWORD" -f "$SELF/pre.sql"

# --- GoTrue (Auth) -------------------------------------------------
# IMPORTANTE: search_path=auth + namespace=auth fazem o GoTrue criar a tabela
# schema_migrations dentro do schema "auth" (onde supabase_auth_admin tem
# permissão), evitando "permission denied for schema public" na migração.
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@127.0.0.1:5432/postgres?sslmode=disable&search_path=auth"
export GOTRUE_DB_NAMESPACE=auth
export GOTRUE_API_HOST=0.0.0.0
export GOTRUE_API_PORT=9999
export API_EXTERNAL_URL="$PUBLIC_URL"
export GOTRUE_SITE_URL="$PUBLIC_URL"
export GOTRUE_URI_ALLOW_LIST="*"
export GOTRUE_DISABLE_SIGNUP="false"
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export GOTRUE_JWT_EXP="3600"
export GOTRUE_JWT_DEFAULT_GROUP_NAME="authenticated"
export GOTRUE_JWT_ADMIN_ROLES="service_role"
export GOTRUE_JWT_AUD="authenticated"
export GOTRUE_MAILER_AUTOCONFIRM="true"
export GOTRUE_EXTERNAL_EMAIL_ENABLED="true"
export GOTRUE_PASSWORD_MIN_LENGTH="6"
export GOTRUE_PASSWORD_HIBP_ENABLED="false"
export GOTRUE_LOG_LEVEL="info"

cd "$GOTRUE_DIR"
echo ">> Migrando schema de autenticação..."
./gotrue migrate
echo ">> Iniciando Auth..."
./gotrue serve &

echo ">> Aguardando auth.users..."
until psql -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='auth' AND table_name='users'" | grep -q 1; do sleep 1; done

# --- Schema do app -------------------------------------------------
if psql -tAc "SELECT (EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') AND EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_roles'))" | grep -q t; then
  echo ">> Schema principal já existe; pulando criação."
else
  echo ">> Aplicando schema do app..."
  psql -v ON_ERROR_STOP=1 -f "$SELF/schema.sql"
fi

echo ">> Garantindo admin padrão..."
psql -v ON_ERROR_STOP=1 -v admin_email="$ADMIN_EMAIL" -v admin_password="$ADMIN_PASSWORD" -f "$SELF/direct-admin.sql"
psql -v ON_ERROR_STOP=1 -v admin_email="$ADMIN_EMAIL" -f "$SELF/admin.sql"
echo ">> Admin: $ADMIN_EMAIL"

# --- PostgREST (Data API) -----------------------------------------
export PGRST_DB_URI="postgres://postgres@127.0.0.1:5432/postgres"
export PGRST_DB_SCHEMAS="public"
export PGRST_DB_ANON_ROLE="anon"
export PGRST_JWT_SECRET="$JWT_SECRET"
export PGRST_SERVER_PORT="3001"
export PGRST_DB_USE_LEGACY_GUCS="false"
echo ">> Iniciando API (PostgREST)..."
postgrest &

# --- App Node (SSR) ------------------------------------------------
cd "$APP_DIR/runtime"
echo ">> Ajustando URL pública no bundle..."
find . -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.html" -o -name "*.json" \) \
  -exec sed -i "s#http://localhost:8000#$PUBLIC_URL#g;s#http://127.0.0.1:8000#$PUBLIC_URL#g" {} + 2>/dev/null || true

export SUPABASE_URL="http://127.0.0.1:${LISTEN_PORT}"
export SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_PROJECT_ID="local"
export INGEST_SECRET="${INGEST_SECRET:-local-ingest-secret}"
export HOST=127.0.0.1
export PORT="$APP_INTERNAL_PORT"
echo ">> Iniciando app..."
if [ -f .output/server/index.mjs ]; then
  node .output/server/index.mjs &
else
  node serve.mjs &
fi

# --- nginx (porta pública única) -----------------------------------
export NGINX_PORT="$LISTEN_PORT"
export APP_PORT="$APP_INTERNAL_PORT"
envsubst '${NGINX_PORT} ${APP_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
echo ">> Pronto! Acesse: $PUBLIC_URL"
exec nginx -g 'daemon off;'
