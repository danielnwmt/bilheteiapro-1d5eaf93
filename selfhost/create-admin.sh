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
BASE="http://localhost:${SUPABASE_PORT}"

PSQL=( $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres )

# ---------- 1) Garante que o Auth (GoTrue) está respondendo ----------
echo ">> Aguardando o serviço de autenticação..."
for i in $(seq 1 60); do
  if curl -fsS "$BASE/auth/v1/health" >/dev/null 2>&1 \
     || curl -fsS "$BASE/auth/v1/settings" -H "apikey: ${ANON_KEY}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ---------- 2) Cria o usuário via API Admin (idempotente, com retry) ----------
echo ">> Criando/atualizando admin via API do Auth..."
CREATE_BODY=$(printf '{"email":"%s","password":"%s","email_confirm":true,"user_metadata":{"nome":"Administrador"}}' \
  "$ADMIN_EMAIL" "$ADMIN_PASSWORD")

CREATE_CODE=000
for i in $(seq 1 30); do
  CREATE_RESP=$(curl -s -w '\n%{http_code}' -X POST "$BASE/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$CREATE_BODY" || true)
  CREATE_CODE=$(printf '%s' "$CREATE_RESP" | tail -n1)
  # 200/201 = criado; 422 = já existe (idempotente) -> sai do loop
  case "$CREATE_CODE" in
    200|201|422) break ;;
    *) echo ">> Auth ainda indisponivel (HTTP $CREATE_CODE), tentando de novo... ($i/30)"; sleep 3 ;;
  esac
done
echo ">> Resposta criação (HTTP $CREATE_CODE)"

# ---------- 3) Descobre o id do usuário no banco ----------
UID_DB=$("${PSQL[@]}" -tAc \
  "SELECT id FROM auth.users WHERE lower(email)=lower('$ADMIN_EMAIL') LIMIT 1" 2>/dev/null | tr -d '[:space:]' || true)

# Se já existia, garante a senha/confirmação via update
if [ -n "$UID_DB" ] && [ "$CREATE_CODE" != "200" ] && [ "$CREATE_CODE" != "201" ]; then
  echo ">> Usuário já existia — atualizando senha..."
  UPDATE_BODY=$(printf '{"password":"%s","email_confirm":true}' "$ADMIN_PASSWORD")
  curl -s -o /dev/null -X PUT "$BASE/auth/v1/admin/users/${UID_DB}" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$UPDATE_BODY" || true
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
  echo " ATENÇÃO: não foi possível confirmar o papel admin."
  echo " Papéis atuais: ${ROLES:-nenhum}"
fi
echo "============================================================"
