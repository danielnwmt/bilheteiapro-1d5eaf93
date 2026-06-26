#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Cria/garante o admin padrão usando a API Admin do GoTrue.
#  Esta é a forma OFICIAL e compatível com a versão do Auth em
#  uso — evita os problemas de inserir direto em auth.users.
#  Uso: bash create-admin.sh   (precisa do .env já gerado)
# ============================================================

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
SUPABASE_PORT="${SUPABASE_PORT:-8000}"
AUTH_PORT="${AUTH_PORT:-9999}"

PSQL=( $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres )

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

run_direct_admin_fallback() {
  echo ">> API do Auth indisponível. Usando fallback SQL local para criar/atualizar admin..."
  $DC cp direct-admin.sql db:/tmp/direct-admin.sql
  "${PSQL[@]}" -v admin_email="$ADMIN_EMAIL" -v admin_password="$ADMIN_PASSWORD" -f /tmp/direct-admin.sql
  USED_SQL_FALLBACK=1
}

AUTH_CID="$($DC ps -q auth 2>/dev/null || true)"
if [ -z "$AUTH_CID" ]; then
  echo ">> Subindo serviço de autenticação..."
  $DC up -d --force-recreate auth
  AUTH_CID="$($DC ps -q auth 2>/dev/null || true)"
fi

if [ -z "$AUTH_CID" ]; then
  echo "ERRO: container de autenticação não encontrado."
  exit 1
fi

AUTH_INTERNAL_URL="${AUTH_API_URL:-http://127.0.0.1:${AUTH_PORT}}"
AUTH_GATEWAY_URL="http://127.0.0.1:${SUPABASE_PORT}/auth/v1"
USED_SQL_FALLBACK=0

auth_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    return 127
  fi
  curl "$@"
}

# Requisição ao Auth via curl do host (presente após instalar o Docker).
# Ecoa o corpo + "\n<http_code>" na última linha. Se não houver curl, retorna 127.
auth_req() {
  local method="$1" path="$2" body="${3:-}"
  if ! command -v curl >/dev/null 2>&1; then
    return 127
  fi
  if [ -n "$body" ]; then
    curl -sS --max-time 20 -w '\n%{http_code}' -X "$method" "${AUTH_INTERNAL_URL}${path}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null || true
  else
    curl -sS --max-time 20 -w '\n%{http_code}' -X "$method" "${AUTH_INTERNAL_URL}${path}" \
      -H "apikey: ${SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" 2>/dev/null || true
  fi
}

# Saúde do Auth: checa DENTRO da rede do Docker (wget --spider do próprio
# container — BusyBox suporta --spider) e, como reforço, pela porta do host.
auth_health() {
  if $DC exec -T auth wget -q -O /dev/null --spider "http://127.0.0.1:9999/health" 2>/dev/null; then
    return 0
  fi
  if command -v curl >/dev/null 2>&1; then
    local hc
    hc="$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH_INTERNAL_URL}/health" 2>/dev/null || printf '000')"
    [ "$hc" = "200" ] || [ "$hc" = "204" ]
    return $?
  fi
  return 1
}

# Garante o gateway local quando este script for chamado separadamente.
$DC up -d rest kong >/dev/null 2>&1 || true

admin_user_id() {
  local safe_email
  safe_email="$(sql_escape "$ADMIN_EMAIL")"
  "${PSQL[@]}" -tAc \
    "SELECT id FROM auth.users WHERE lower(email)=lower('$safe_email') LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true
}

# ---------- 1) Garante que o Auth (GoTrue) está respondendo ----------
echo ">> Aguardando o serviço de autenticação..."
AUTH_READY=0
for i in $(seq 1 45); do
  if auth_health; then
    AUTH_READY=1
    break
  fi
  echo ">> Auth ainda subindo, tentando de novo... ($i/45)"
  sleep 2
done

if [ "$AUTH_READY" != "1" ]; then
  echo "ATENÇÃO: Auth não ficou pronto pela API. Últimas linhas do log:"
  $DC logs --tail=80 auth || true
  run_direct_admin_fallback
fi

# ---------- 2) Cria o usuário via API Admin (idempotente, com retry) ----------
echo ">> Criando/atualizando admin via API do Auth..."
CREATE_BODY=$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"nome":"Administrador"}}' \
  "$ADMIN_EMAIL" "$ADMIN_PASSWORD")

CREATE_CODE=200
CREATE_RESP=""
if [ "$AUTH_READY" = "1" ]; then
  CREATE_CODE=000
  for i in $(seq 1 60); do
    CREATE_RESP="$(auth_req POST /admin/users "$CREATE_BODY")"
    # o curl coloca o código HTTP na última linha (-w '\n%{http_code}')
    CREATE_CODE="$(printf '%s' "$CREATE_RESP" | tail -n1 | tr -dc '0-9')"
    [ -z "$CREATE_CODE" ] && CREATE_CODE=000
    # 200/201 = criado; 422 = já existe (idempotente) -> sai do loop
    case "$CREATE_CODE" in
      200|201|422) break ;;
      *)
        # Algumas versões retornam 400 se o e-mail já existe. Se já existe no banco, seguimos.
        if [ "$CREATE_CODE" = "400" ] && [ -n "$(admin_user_id)" ]; then break; fi
        # Se o usuário já apareceu no banco, também seguimos.
        if [ -n "$(admin_user_id)" ]; then break; fi
        echo ">> Auth ainda não criou o admin (HTTP $CREATE_CODE), tentando de novo... ($i/60)"
        sleep 3
        ;;
    esac
  done
fi
echo ">> Resposta criação (HTTP $CREATE_CODE)"

if ! printf '%s' "$CREATE_CODE" | grep -Eq '^(200|201|400|422)$'; then
  echo "ATENÇÃO: falha ao criar o admin pela API do Auth. Resposta:"
  printf '%s\n' "$CREATE_RESP" | sed '$d' | head -c 1200 || true
  echo ""
  echo "Últimas linhas do log do Auth:"
  $DC logs --tail=80 auth || true
  run_direct_admin_fallback
fi

# ---------- 3) Descobre o id do usuário no banco ----------
UID_DB=""
for i in $(seq 1 30); do
  UID_DB="$(admin_user_id)"
  [ -n "$UID_DB" ] && break
  sleep 2
done

if [ -z "$UID_DB" ]; then
  echo "ATENÇÃO: o admin não apareceu em auth.users após a criação via API. Tentando fallback SQL."
  run_direct_admin_fallback
  UID_DB="$(admin_user_id)"
fi

if [ -z "$UID_DB" ]; then
  echo "ERRO: o admin não apareceu em auth.users nem após fallback SQL."
  echo "Últimas linhas do log do Auth:"
  $DC logs --tail=80 auth || true
  exit 1
fi

# Garante senha/confirmação mesmo quando o usuário já existia.
echo ">> Garantindo senha e confirmação do admin..."
UPDATE_BODY=$(printf '{"password":"%s","email_confirm":true}' "$ADMIN_PASSWORD")
if [ "$AUTH_READY" = "1" ] && [ "$USED_SQL_FALLBACK" != "1" ]; then
  auth_req PUT "/admin/users/${UID_DB}" "$UPDATE_BODY" >/dev/null 2>&1 || true
else
  run_direct_admin_fallback
fi

# ---------- 4) Garante PERFIL + PAPEL admin no banco ----------
echo ">> Garantindo papel de administrador..."
$DC cp admin.sql db:/tmp/admin.sql
"${PSQL[@]}" -v admin_email="$ADMIN_EMAIL" -f /tmp/admin.sql

# ---------- 5) Confirma ----------
ROLES=$("${PSQL[@]}" -tAc \
  "SELECT string_agg(r.role::text, ',') FROM public.user_roles r
   JOIN auth.users u ON u.id=r.user_id
   WHERE lower(u.email)=lower('$ADMIN_EMAIL')" 2>/dev/null | tr -d '[:space:]' || true)

echo "============================================================"
if printf '%s' "$ROLES" | grep -q admin; then
  echo " Admin pronto: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}"
  echo " Papéis: ${ROLES}"
else
  echo " ERRO: não foi possível confirmar o papel admin."
  echo " Papéis atuais: ${ROLES:-nenhum}"
  exit 1
fi
echo "============================================================"
