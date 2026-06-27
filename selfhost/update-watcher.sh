#!/usr/bin/env bash
# ============================================================
# BilheteIA PRO — Watcher de atualização (roda no HOST da VPS)
# Monitora o arquivo-gatilho gravado pelo botão "Atualizar sistema"
# e roda o deploy.sh automaticamente quando solicitado.
#
# Instalado e ativado automaticamente pelo deploy.sh. Para rodar manual:
#   APP_DIR=/opt/lovable/app bash selfhost/update-watcher.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
TRIGGER_DIR="${TRIGGER_DIR:-$APP_DIR/deploy-trigger}"
TRIGGER_FILE="$TRIGGER_DIR/request"
HEARTBEAT_FILE="$TRIGGER_DIR/watcher-alive"
LOG_FILE="$TRIGGER_DIR/last-update.log"
SSL_REQUEST_FILE="$TRIGGER_DIR/ssl-request"
SSL_STATUS_FILE="$TRIGGER_DIR/ssl-status"
SSL_LOG_FILE="$TRIGGER_DIR/ssl.log"

mkdir -p "$TRIGGER_DIR"
chmod 777 "$TRIGGER_DIR" 2>/dev/null || true
touch "$SSL_LOG_FILE" "$SSL_STATUS_FILE" 2>/dev/null || true
chmod 666 "$SSL_LOG_FILE" "$SSL_STATUS_FILE" 2>/dev/null || true
LAST=""
[ -f "$TRIGGER_FILE" ] && LAST="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"
# Não marque o pedido SSL existente como processado no boot. Se o usuário clicou
# enquanto o serviço estava parado, o watcher precisa executar assim que subir.
LAST_SSL=""

app_port() {
  local port="${APP_PORT:-${PORT:-3000}}"
  if [ -f "$APP_DIR/.env" ]; then
    port="$(grep -E '^(APP_PORT|PORT)=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
    [ -z "$port" ] && port="3000"
  fi
  echo "$port"
}

apt_wait() {
  # Espera o lock do apt/dpkg liberar (unattended-upgrades costuma segurar no boot).
  local t=0
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 \
     || fuser /var/lib/dpkg/lock >/dev/null 2>&1 \
     || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    echo ">> Aguardando o apt liberar (outro processo está instalando)... ${t}s"
    sleep 5
    t=$((t+5))
    [ "$t" -ge 300 ] && { echo ">> Timeout esperando o apt. Tentando mesmo assim."; break; }
  done
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt_wait
  apt-get update -y || true
  apt_wait
  apt-get install -y "$@"
}

ensure_host_nginx_proxy() {
  local dominio="$1"
  local port
  port="$(app_port)"

  if ! command -v nginx >/dev/null 2>&1; then
    echo ">> Instalando nginx no host..."
    apt_install nginx
  fi

  if ! command -v nginx >/dev/null 2>&1; then
    echo ">> ERRO: nginx não pôde ser instalado (apt travado). Abortando."
    return 1
  fi


  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  cat > "/etc/nginx/sites-available/bilheteia-$dominio.conf" <<EOF
server {
    listen 80;
    server_name $dominio;

    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  ln -sf "/etc/nginx/sites-available/bilheteia-$dominio.conf" "/etc/nginx/sites-enabled/bilheteia-$dominio.conf"
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t
  systemctl enable --now nginx 2>/dev/null || true
  systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
}

# Instala/renova o certificado SSL via certbot a partir do pedido do painel.
install_ssl() {
  local payload="$1"
  local dominio email
  dominio="$(echo "$payload" | grep -oE '"dominio":"[^"]*"' | head -n1 | cut -d'"' -f4)"
  email="$(echo "$payload" | grep -oE '"email":"[^"]*"' | head -n1 | cut -d'"' -f4)"
  if [ -z "$dominio" ] || [ -z "$email" ]; then
    echo "falha: dominio/email ausentes $(date)" > "$SSL_STATUS_FILE"
    return 1
  fi

  echo "instalando SSL para $dominio $(date)" > "$SSL_STATUS_FILE"
  date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true
  set +e
  {
    echo ">> [$(date)] Instalando SSL para $dominio ($email)"
    if ! command -v certbot >/dev/null 2>&1; then
      echo ">> Instalando certbot..."
      (apt-get update -y && apt-get install -y certbot python3-certbot-nginx) || \
        (command -v snap >/dev/null 2>&1 && snap install --classic certbot) || true
    fi

    if ! command -v certbot >/dev/null 2>&1; then
      echo ">> ERRO: certbot não foi instalado."
      exit 1
    fi

    ensure_host_nginx_proxy "$dominio"
    certbot --nginx --non-interactive --agree-tos -m "$email" -d "$dominio" --redirect
  } >> "$SSL_LOG_FILE" 2>&1
  local code=$?
  set -e

  if [ $code -eq 0 ]; then
    echo "ok: SSL instalado para $dominio $(date)" > "$SSL_STATUS_FILE"
  else
    echo "falha ao instalar SSL para $dominio $(date) — veja $SSL_LOG_FILE" > "$SSL_STATUS_FILE"
  fi
  chmod 666 "$SSL_LOG_FILE" "$SSL_STATUS_FILE" 2>/dev/null || true
  date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true
}

echo ">> Watcher de atualização ativo. Monitorando $TRIGGER_FILE"
# Sinaliza imediatamente que o watcher está vivo (o painel checa este arquivo).
date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true

# Mantém o pulso vivo mesmo enquanto deploy.sh/certbot estão rodando.
heartbeat_loop() {
  while true; do
    date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true
    sleep 10
  done
}
heartbeat_loop &
HEARTBEAT_PID=$!
trap 'kill "$HEARTBEAT_PID" 2>/dev/null || true' EXIT

while true; do
  # Pulso de vida: o botão "Atualizar sistema" usa isto para saber que o
  # watcher está rodando no host. Atualizado a cada ciclo.
  date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true

  if [ -f "$TRIGGER_FILE" ]; then
    CUR="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"
    if [ -n "$CUR" ] && [ "$CUR" != "$LAST" ]; then
      LAST="$CUR"
      echo ">> [$(date)] Atualização solicitada pelo painel. Rodando deploy.sh..."
      echo "iniciada $(date)" > "$TRIGGER_DIR/status" 2>/dev/null || true
      if (cd "$APP_DIR" && bash deploy.sh) >> "$LOG_FILE" 2>&1; then
        echo ">> [$(date)] Atualização concluída com sucesso."
        echo "ok $(date)" > "$TRIGGER_DIR/status" 2>/dev/null || true
      else
        echo ">> [$(date)] FALHA na atualização. Veja $LOG_FILE"
        echo "falha $(date)" > "$TRIGGER_DIR/status" 2>/dev/null || true
      fi
    fi
  fi

  # Pedido de instalação de SSL vindo do painel.
  if [ -f "$SSL_REQUEST_FILE" ]; then
    CUR_SSL="$(cat "$SSL_REQUEST_FILE" 2>/dev/null || true)"
    if [ -n "$CUR_SSL" ] && [ "$CUR_SSL" != "$LAST_SSL" ]; then
      LAST_SSL="$CUR_SSL"
      echo ">> [$(date)] SSL solicitado pelo painel."
      install_ssl "$CUR_SSL"
    fi
  fi

  sleep 5
done
