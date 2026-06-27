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

mkdir -p "$TRIGGER_DIR"
chmod 777 "$TRIGGER_DIR" 2>/dev/null || true
LAST=""
[ -f "$TRIGGER_FILE" ] && LAST="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"

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
  sleep 5
done
