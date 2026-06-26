# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

# Public (publishable) backend config — safe to bake into the image.
# Override at build time with --build-arg if needed.
ARG VITE_SUPABASE_URL="https://zzjrfmiqhlwomablszdj.supabase.co"
ARG VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6anJmbWlxaGx3b21hYmxzemRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzg5NDksImV4cCI6MjA5Nzc1NDk0OX0.ycHZosTLK6KClr0o0TPlVptwteEWhzc5W9Vu2uixABI"
ARG VITE_SUPABASE_PROJECT_ID="zzjrfmiqhlwomablszdj"
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
ENV SUPABASE_URL=$VITE_SUPABASE_URL
ENV SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

COPY package.json bun.lock ./
# Retry with a clean cache if a tarball integrity check fails (corrupted bun cache).
RUN bun install --frozen-lockfile \
    || (echo ">> Integrity falhou, limpando cache e tentando de novo..." \
        && rm -rf /root/.bun/install/cache ~/.bun/install/cache /tmp/bun-* \
        && bun install --frozen-lockfile) \
    || (echo ">> Tentando sem frozen-lockfile..." \
        && rm -rf /root/.bun/install/cache ~/.bun/install/cache \
        && bun install)
COPY . .
RUN bun run build && \
    mkdir -p /app/runtime && \
    if [ -d .output ]; then cp -R .output /app/runtime/.output; fi && \
    if [ -d dist ]; then cp -R dist /app/runtime/dist; fi && \
    cp serve.mjs /app/runtime/serve.mjs

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV SUPABASE_PUBLIC_URL=""

# Public backend config available to the server at runtime too.
ENV SUPABASE_URL="https://zzjrfmiqhlwomablszdj.supabase.co"
ENV SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp6anJmbWlxaGx3b21hYmxzemRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNzg5NDksImV4cCI6MjA5Nzc1NDk0OX0.ycHZosTLK6KClr0o0TPlVptwteEWhzc5W9Vu2uixABI"
ENV SUPABASE_PROJECT_ID="zzjrfmiqhlwomablszdj"

COPY --from=build /app/runtime ./
EXPOSE 3000
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'PUBLIC_URL="${SUPABASE_PUBLIC_URL:-}"' \
    'if [ -z "$PUBLIC_URL" ]; then' \
    '  IP=$(wget -qO- --timeout=4 https://ifconfig.me 2>/dev/null || true)' \
    '  PUBLIC_URL="http://${IP:-localhost}:8000"' \
    'fi' \
    'find . -type f \( -name "*.js" -o -name "*.mjs" -o -name "*.html" -o -name "*.json" \) -exec sed -i "s#http://localhost:8000#$PUBLIC_URL#g;s#http://127.0.0.1:8000#$PUBLIC_URL#g" {} + 2>/dev/null || true' \
    'if [ -f .output/server/index.mjs ]; then node .output/server/index.mjs; else node serve.mjs; fi' \
    > /app/start.sh && chmod +x /app/start.sh
CMD ["/app/start.sh"]
