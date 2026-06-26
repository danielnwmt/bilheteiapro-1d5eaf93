# ============================================================
# BilheteIA PRO — imagem TUDO-EM-UM (1 clique, banco LOCAL)
# Um único container: Postgres + Auth + API + app, porta única.
# Funciona tanto via docker-compose quanto só pelo Dockerfile.
# ============================================================

# ---- Build stage (Bun) ----
FROM oven/bun:1 AS build
WORKDIR /app

# Config pública do backend LOCAL — assada no bundle.
# A URL é um placeholder substituído em runtime pela URL pública real.
ARG VITE_SUPABASE_URL="http://localhost:8000"
ARG VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgyNDQwMDAwLCJleHAiOjIwOTc4MDAwMDB9.mX6rq28Z0cpvC22UaLwB1AZHIrjrurs5W-faJBMopsg"
ARG VITE_SUPABASE_PROJECT_ID="local"
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
ENV SUPABASE_URL=$VITE_SUPABASE_URL
ENV SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile \
    || (rm -rf /root/.bun/install/cache ~/.bun/install/cache /tmp/bun-* && bun install --frozen-lockfile) \
    || (rm -rf /root/.bun/install/cache ~/.bun/install/cache && bun install)
COPY . .
RUN bun run build && \
    mkdir -p /app/runtime && \
    if [ -d .output ]; then cp -R .output /app/runtime/.output; fi && \
    if [ -d dist ]; then cp -R dist /app/runtime/dist; fi && \
    cp serve.mjs /app/runtime/serve.mjs

# ---- Runtime stage (Node 20 + Postgres + Auth + API + nginx) ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /opt/app
ENV NODE_ENV=production
ENV PORT=3000
ENV SUPABASE_PUBLIC_URL=""

# Pacotes do sistema: Postgres 15, nginx, utilitários.
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql postgresql-contrib postgresql-client \
      nginx-light gettext-base ca-certificates wget xz-utils \
    && rm -rf /var/lib/apt/lists/*

# GoTrue (Auth) — binário + migrations.
RUN wget -qO /tmp/auth.tar.xz https://github.com/supabase/auth/releases/download/v2.191.0/auth-v2.191.0-amd64.tar.xz \
    && mkdir -p /opt/gotrue \
    && tar -xJf /tmp/auth.tar.xz -C /opt/gotrue \
    && chmod +x /opt/gotrue/gotrue /opt/gotrue/auth 2>/dev/null || true \
    && rm -f /tmp/auth.tar.xz

# PostgREST (Data API) — binário estático.
RUN wget -qO /tmp/pgrst.tar.xz https://github.com/PostgREST/postgrest/releases/download/v14.13/postgrest-v14.13-linux-static-x86-64.tar.xz \
    && tar -xJf /tmp/pgrst.tar.xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/postgrest \
    && rm -f /tmp/pgrst.tar.xz

# App + SQL de instalação.
COPY --from=build /app/runtime /opt/app/runtime
COPY selfhost /opt/app/selfhost

# nginx (porta única) + entrypoint.
RUN mkdir -p /etc/nginx/templates \
    && cp /opt/app/selfhost/allinone/default.conf.template /etc/nginx/templates/default.conf.template \
    && cp /opt/app/selfhost/allinone/entrypoint.sh /opt/entrypoint.sh \
    && chmod +x /opt/entrypoint.sh

VOLUME ["/var/lib/postgresql/data"]
EXPOSE 3000
CMD ["/opt/entrypoint.sh"]
