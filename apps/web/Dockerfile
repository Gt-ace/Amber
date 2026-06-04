# syntax=docker/dockerfile:1.7

# Stage 1 — build the SvelteKit app with full dev deps.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# Stage 2 — runtime. Bun (not Node), because lib/space/cache.ts imports
# `bun:sqlite`, which Node's loader cannot resolve. adapter-node's output
# runs under Bun unchanged. wget is the compose healthcheck.
FROM oven/bun:1-slim AS runtime
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends wget \
	&& rm -rf /var/lib/apt/lists/*

COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --production --frozen-lockfile \
	&& chown -R bun:bun node_modules
COPY --from=build --chown=bun:bun /app/build ./build

USER bun

ENV NODE_ENV=production \
	PORT=3000 \
	HOST=0.0.0.0 \
	AMBER_SPACE_PATH=/space \
	AMBER_BUNDLED_THEMES_DIR=/app/build/themes

EXPOSE 3000

CMD ["bun", "./build/index.js"]
