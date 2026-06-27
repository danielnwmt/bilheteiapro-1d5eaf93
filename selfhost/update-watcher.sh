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
LAST=""
[ -f "$TRIGGER_FILE" ] && LAST="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"
LAST_SSL=""
[ -f "$SSL_REQUEST_FILE" ] && LAST_SSL="$(cat "$SSL_REQUEST_FILE" 2>/dev/null || true)"

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
  {
    echo ">> [$(date)] Instalando SSL para $dominio ($email)"
    if ! command -v certbot >/dev/null 2>&1; then
      echo ">> Instalando certbot..."
      (apt-get update -y && apt-get install -y certbot python3-certbot-nginx) || \
        (command -v snap >/dev/null 2>&1 && snap install --classic certbot) || true
    fi

    if command -v nginx >/dev/null 2>&1; then
      certbot --nginx --non-interactive --agree-tos -m "$email" -d "$dominio" --redirect
    else
      # Sem nginx no host: emite em modo standalone (porta 80 precisa estar livre).
      certbot certonly --standalone --non-interactive --agree-tos -m "$email" -d "$dominio"
    fi
  } >> "$SSL_LOG_FILE" 2>&1

  if [ $? -eq 0 ]; then
    echo "ok: SSL instalado para $dominio $(date)" > "$SSL_STATUS_FILE"
  else
    echo "falha ao instalar SSL para $dominio $(date) — veja $SSL_LOG_FILE" > "$SSL_STATUS_FILE"
  fi
}

echo ">> Watcher de atualização ativo. Monitorando $TRIGGER_FILE"
# Sinaliza imediatamente que o watcher está vivo (o painel checa este arquivo).
date +%s > "$HEARTBEAT_FILE" 2>/dev/null || true

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
