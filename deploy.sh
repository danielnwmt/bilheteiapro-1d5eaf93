#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Deploy automático do BilheteIA na VPS
#  Uso:  bash deploy.sh
#  Faz tudo sozinho: pull, build, e sobe o container com restart automático.
# ============================================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
IMAGE="lovable-app"
CONTAINER="lovable-app"
PORT="3000"

if [ ! -d "$APP_DIR" ]; then
  echo "ERRO: pasta do app não encontrada: $APP_DIR"
  echo "Entre na pasta onde está o deploy.sh e rode: bash deploy.sh"
  exit 1
fi

cd "$APP_DIR"

# Modo padrão para VPS/Localweb: TUDO-EM-UM (Postgres + Auth + API + app)
# num único container, na mesma porta. Sem serviços duplicados.
# Para usar o backend do Cloud em vez do banco local, rode:
#   BILHETEIA_CLOUD=1 bash deploy.sh
if [ "${BILHETEIA_CLOUD:-0}" != "1" ] && [ -f "$APP_DIR/docker-compose.yml" ]; then
  echo ">> Modo local (tudo-em-um) detectado: Postgres + Auth + API + app num só container..."

  # Garante Docker + Compose instalados (instala automaticamente se faltar).
  ensure_docker() {
    if docker compose version >/dev/null 2>&1; then
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
    if ! docker compose version >/dev/null 2>&1; then
      echo "ERRO: falha ao instalar o Docker automaticamente. Instale manualmente e rode de novo."
      exit 1
    fi
    echo ">> Docker instalado com sucesso."
  }
  ensure_docker

  if [ -d "$APP_DIR/.git" ]; then
    echo ">> Atualizando código..."
    git pull || true
  fi

  # Detecta a URL pública (IPv4, depois IPv6) só se ainda não estiver no .env.
  touch "$APP_DIR/.env"
  if [ -z "${SUPABASE_PUBLIC_URL:-}" ] && ! grep -q "^SUPABASE_PUBLIC_URL=." "$APP_DIR/.env"; then
    IP4=$(curl -4 -s --max-time 5 https://api.ipify.org 2>/dev/null || curl -4 -s --max-time 5 https://ifconfig.me 2>/dev/null || true)
    if [ -n "$IP4" ]; then
      HOSTADDR="$IP4"
    else
      IP6=$(curl -6 -s --max-time 5 https://api6.ipify.org 2>/dev/null || true)
      [ -n "$IP6" ] && HOSTADDR="[$IP6]" || HOSTADDR="localhost"
    fi
    echo "SUPABASE_PUBLIC_URL=http://${HOSTADDR}:${PORT}" >> "$APP_DIR/.env"
    echo ">> URL pública detectada: http://${HOSTADDR}:${PORT}"
  fi

  # Limpa serviços antigos da arquitetura anterior (db/auth/rest/kong separados).
  if [ -f "$APP_DIR/selfhost/docker-compose.yml" ]; then
    (cd "$APP_DIR/selfhost" && docker compose down 2>/dev/null || true)
  fi

  echo ">> Buildando e subindo o container..."
  docker compose up -d --build

  # Instala/ativa o watcher de atualização no host (para o botão "Atualizar sistema").
  install_updater() {
    mkdir -p "$APP_DIR/deploy-trigger"
    if command -v systemctl >/dev/null 2>&1; then
      cat > /etc/systemd/system/bilheteia-updater.service <<EOF
[Unit]
Description=BilheteIA - watcher de atualizacao
After=docker.service
Wants=docker.service

[Service]
Type=simple
Environment=APP_DIR=$APP_DIR
ExecStart=/usr/bin/env bash $APP_DIR/selfhost/update-watcher.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload 2>/dev/null || true
      systemctl enable bilheteia-updater.service 2>/dev/null || true
      # Sempre reinicia para carregar a versão nova do watcher após atualizar o código.
      # Sem isso o serviço podia continuar rodando o script antigo e o painel mostrava
      # falso erro de "watcher não está rodando" no SSL.
      systemctl restart bilheteia-updater.service 2>/dev/null || systemctl start bilheteia-updater.service 2>/dev/null || true
      echo ">> Watcher de atualização ativado (systemd)."
    else
      # Sem systemd: roda em segundo plano com nohup.
      if ! pgrep -f "update-watcher.sh" >/dev/null 2>&1; then
        APP_DIR="$APP_DIR" nohup bash "$APP_DIR/selfhost/update-watcher.sh" >/dev/null 2>&1 &
        echo ">> Watcher de atualização ativado (nohup)."
      fi
    fi
  }
  install_updater || echo ">> Aviso: não foi possível ativar o watcher de atualização automaticamente."

  echo ">> Pronto! App rodando na porta $PORT."
  exit 0
fi


# 1) Garante o arquivo .env sem travar atualização pedindo dados.
#    Chaves de APIs são configuradas depois pelo painel Admin.

# Valores fixos do backend (preenchidos automaticamente)
SUPABASE_URL_DEFAULT="https://zzjrfmiqhlwomablszdj.supabase.co"
SUPABASE_PUBLISHABLE_KEY_DEFAULT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6anJmbWlxaGx3b21hYmxzemRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzg5NDksImV4cCI6MjA5Nzc1NDk0OX0.ycHZosTLK6KClr0o0TPlVptwteEWhzc5W9Vu2uixABI"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Garante uma chave no .env. Nunca pede no terminal durante atualização.
ensure_key() {
  local key="$1" default="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then return; fi
  if [ -n "$default" ]; then
    echo "${key}=${default}" >> "$ENV_FILE"
    echo ">> $key preenchido automaticamente."
  else
    echo "${key}=" >> "$ENV_FILE"
    echo ">> $key criado vazio. Configure depois se necessário."
  fi
}

echo ">> Conferindo variáveis do .env..."
ensure_key SUPABASE_URL "$SUPABASE_URL_DEFAULT"
ensure_key SUPABASE_PUBLISHABLE_KEY "$SUPABASE_PUBLISHABLE_KEY_DEFAULT"
ensure_key SUPABASE_SERVICE_ROLE_KEY ""
# GEMINI_API_KEY, API_FOOTBALL_KEY, ODDS_API_KEY e demais chaves de integração
# são adicionadas manualmente no painel Admin -> APIs do sistema (após instalar).
ensure_key INGEST_SECRET ""

# 2) Atualiza o código
echo ">> Atualizando código..."
git pull

# 3) Build limpo
echo ">> Buildando imagem..."
docker build --no-cache -t "$IMAGE" .

# 4) Sobe o container (reinicia sozinho se cair / reboot)
echo ">> Subindo container..."
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  --restart always \
  -p "$PORT:3000" \
  --env-file "$ENV_FILE" \
  "$IMAGE"

# 5) Checa
sleep 6
echo ">> Status:"
curl -I "http://127.0.0.1:$PORT" || true
echo ">> Pronto! App rodando na porta $PORT."
