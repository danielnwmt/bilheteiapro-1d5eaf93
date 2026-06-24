# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies (use lockfile)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build with the Node server preset (instead of Cloudflare)
COPY . .
ENV NITRO_PRESET=node-server
ENV SERVER_PRESET=node-server
RUN bun run build

# ---- Runtime stage ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Only the built server output is needed at runtime
COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
