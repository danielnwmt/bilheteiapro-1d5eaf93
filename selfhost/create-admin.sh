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

PSQL=( $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres )

AUTH_CID="$($DC ps -q auth 2>/dev/null || true)"
if [ -z "$AUTH_CID" ]; then
  echo ">> Subindo serviço de autenticação..."
  $DC up -d auth
  AUTH_CID="$($DC ps -q auth 2>/dev/null || true)"
fi

if [ -z "$AUTH_CID" ]; then
  echo "ERRO: container de autenticação não encontrado."
  exit 1
fi

AUTH_NETWORK="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$AUTH_CID" 2>/dev/null | head -n1)"
if [ -z "$AUTH_NETWORK" ]; then
  echo "ERRO: rede Docker do Auth não encontrada."
  exit 1
fi

AUTH_INTERNAL_URL="http://auth:9999"
AUTH_CURL_IMAGE="curlimages/curl:8.11.1"

auth_curl() {
  docker run --rm --network "$AUTH_NETWORK" "$AUTH_CURL_IMAGE" "$@"
}

admin_user_id() {
  "${PSQL[@]}" -tAc \
    "SELECT id FROM auth.users WHERE lower(email)=lower('$ADMIN_EMAIL') LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true
}

# ---------- 1) Garante que o Auth (GoTrue) está respondendo ----------
echo ">> Aguardando o serviço de autenticação..."
AUTH_READY=0
for i in $(seq 1 90); do
  HEALTH_CODE="$(auth_curl -sS -o /dev/null -w '%{http_code}' "$AUTH_INTERNAL_URL/health" 2>/dev/null || printf '000')"
  if [ "$HEALTH_CODE" = "200" ] || [ "$HEALTH_CODE" = "204" ]; then
    AUTH_READY=1
    break
  fi
  echo ">> Auth ainda indisponível (HTTP ${HEALTH_CODE}), tentando de novo... ($i/90)"
  sleep 2
done

if [ "$AUTH_READY" != "1" ]; then
  echo "ERRO: Auth não ficou pronto. Últimas linhas do log:"
  $DC logs --tail=80 auth || true
  exit 1
fi

# ---------- 2) Cria o usuário via API Admin (idempotente, com retry) ----------
echo ">> Criando/atualizando admin via API do Auth..."
CREATE_BODY=$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"nome":"Administrador"}}' \
  "$ADMIN_EMAIL" "$ADMIN_PASSWORD")

CREATE_CODE=000
CREATE_RESP=""
for i in $(seq 1 60); do
  CREATE_RESP=$(auth_curl -sS -w '\n%{http_code}' -X POST "$AUTH_INTERNAL_URL/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$CREATE_BODY" 2>/dev/null || true)
  CREATE_CODE=$(printf '%s' "$CREATE_RESP" | tail -n1)
  # 200/201 = criado; 422 = já existe (idempotente) -> sai do loop
  case "$CREATE_CODE" in
    200|201|422) break ;;
    *)
      # Algumas versões retornam 400 se o e-mail já existe. Se já existe no banco, seguimos.
      if [ "$CREATE_CODE" = "400" ] && [ -n "$(admin_user_id)" ]; then break; fi
      echo ">> Auth ainda não criou o admin (HTTP $CREATE_CODE), tentando de novo... ($i/60)"
      sleep 3
      ;;
  esac
done
echo ">> Resposta criação (HTTP $CREATE_CODE)"

if ! printf '%s' "$CREATE_CODE" | grep -Eq '^(200|201|400|422)$'; then
  echo "ERRO: falha ao criar o admin pelo Auth. Resposta:"
  printf '%s\n' "$CREATE_RESP" | sed '$d' | head -c 1200 || true
  echo ""
  echo "Últimas linhas do log do Auth:"
  $DC logs --tail=80 auth || true
  exit 1
fi

# ---------- 3) Descobre o id do usuário no banco ----------
UID_DB=""
for i in $(seq 1 30); do
  UID_DB="$(admin_user_id)"
  [ -n "$UID_DB" ] && break
  sleep 2
done

if [ -z "$UID_DB" ]; then
  echo "ERRO: o admin não apareceu em auth.users após a criação."
  echo "Últimas linhas do log do Auth:"
  $DC logs --tail=80 auth || true
  exit 1
fi

# Garante senha/confirmação mesmo quando o usuário já existia.
echo ">> Garantindo senha e confirmação do admin..."
UPDATE_BODY=$(printf '{"password":"%s","email_confirm":true}' "$ADMIN_PASSWORD")
auth_curl -sS -o /dev/null -X PUT "$AUTH_INTERNAL_URL/admin/users/${UID_DB}" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$UPDATE_BODY" 2>/dev/null || true

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
  echo " ATENÇÃO: não foi possível confirmar o papel admin."
  echo " Papéis atuais: ${ROLES:-nenhum}"
fi
echo "============================================================"
