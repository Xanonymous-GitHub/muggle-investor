# syntax=docker/dockerfile:1

# Build stage: install with Bun and produce the Nitro node-server output (.output/).
FROM oven/bun:1.4.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NITRO_PRESET=node
RUN bun run build
# The runtime stage has no node_modules, so bundle the migration runner (drizzle-orm + postgres)
# into one file that plain node can run.
RUN bun build scripts/migrate.ts --target=node --format=esm --outfile=migrate.mjs

# Runtime stage: the self-contained .output/ (server bundle + traced node_modules), plus the
# bundled migration runner and the SQL migrations it applies.
FROM node:lts-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
# Migrations: docker run --rm -e DATABASE_URL=... <image> node migrate.mjs
COPY --from=build --chown=node:node /app/migrate.mjs ./migrate.mjs
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
