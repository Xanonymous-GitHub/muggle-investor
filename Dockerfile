# syntax=docker/dockerfile:1

# Build stage: install with Bun and produce the Nitro node-server output (.output/).
# Docker Hardened Images (dhi.io) need `docker login dhi.io` before they can be pulled. The -dev
# variant keeps a shell and package-script support; only the runtime stage is the shell-less image.
FROM dhi.io/bun:1-alpine-dev AS build
WORKDIR /app
COPY --link package.json bun.lock ./
# The cache mount keeps Bun's download cache between builds (CI persists it with
# buildkit-cache-dance), so a changed lockfile only fetches the packages that changed.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY --link . .
ENV NITRO_PRESET=node
RUN bun run build
# The runtime stage has no node_modules, so bundle the migration runner (drizzle-orm + postgres)
# into one file that plain node can run.
RUN bun build scripts/migrate.ts --target=node --format=esm --outfile=migrate.mjs

# Runtime stage: the self-contained .output/ (server bundle + traced node_modules), plus the
# bundled migration runner and the SQL migrations it applies.
FROM dhi.io/node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
# The files stay root-owned and are only readable (a=rX: read for all, execute for directories), so
# the non-root `node` user can run the app but a compromised process cannot rewrite it.
COPY --link --from=build --chmod=a=rX /app/.output ./.output
# Migrations: docker run --rm -e DATABASE_URL=... <image> node migrate.mjs
COPY --link --from=build --chmod=a=rX /app/migrate.mjs ./migrate.mjs
COPY --link --from=build --chmod=a=rX /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
