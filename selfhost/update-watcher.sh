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
LOG_FILE="$TRIGGER_DIR/last-update.log"

mkdir -p "$TRIGGER_DIR"
LAST=""
[ -f "$TRIGGER_FILE" ] && LAST="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"

echo ">> Watcher de atualização ativo. Monitorando $TRIGGER_FILE"
while true; do
  if [ -f "$TRIGGER_FILE" ]; then
    CUR="$(cat "$TRIGGER_FILE" 2>/dev/null || true)"
    if [ -n "$CUR" ] && [ "$CUR" != "$LAST" ]; then
      LAST="$CUR"
      echo ">> [$(date)] Atualização solicitada pelo painel. Rodando deploy.sh..."
      if (cd "$APP_DIR" && bash deploy.sh) >> "$LOG_FILE" 2>&1; then
        echo ">> [$(date)] Atualização concluída com sucesso."
      else
        echo ">> [$(date)] FALHA na atualização. Veja $LOG_FILE"
      fi
    fi
  fi
  sleep 5
done
