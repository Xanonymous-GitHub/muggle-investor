# vinext feasibility spike (2026-10-11)

Stack under test: vinext 1.1.0, Vite 8.3.4, Nitro 3.0.260903-beta (`nitro/vite`), Bun 1.4.2, Node 26 (host) / Node 24 LTS (Docker runtime), `@serwist/vite` + `serwist` 9.5.13, Chrome via Playwright 1.64 (`channel: "chrome"`).

## Verdict: GO

All checks pass. One workaround is needed (service-worker generation under the multi-environment build), and it is small and contained in `vite.config.ts`.

## Results

| # | Check | Result | Notes / workaround |
|---|-------|--------|--------------------|
| 2 | Node preset | PASS | `NITRO_PRESET=node bun run build` → `.output/`; `node .output/server/index.mjs` serves `GET /api/health` → `200 {"status":"ok","app":"muggle-investor"}` and `/` → 200. Without `NITRO_PRESET`, local `vite build` also uses the node preset. |
| 2b | Bun as runtime | PASS | `bun .output/server/index.mjs` serves health, page and streaming the same way as Node. |
| 3 | Vercel preset | PASS | `NITRO_PRESET=vercel bun run build` → `.vercel/output/` (Build Output API v3): `config.json`, `static/` (incl. `sw.js`, manifest, icons), `functions/__server.func` with `.vc-config.json` `{ runtime: "nodejs24.x", supportsResponseStreaming: true }`. |
| 4 | Streaming from route handlers | PASS | `ReadableStream` route emitting `chunk-1..5` 300 ms apart. Node build: chunks read at +24/+325/+627/+929/+1232 ms (first→last 1208 ms). `text/event-stream` variant: same cadence (1202 ms), header passed through unchanged, not buffered. Same under Bun (1211 ms), inside Docker (1220 ms) and through the service worker in Chrome (1208 ms). |
| 5 | Service worker / PWA | PASS (workaround) | `@serwist/vite` (`injectManifest`, source `src/sw.ts`). Built `sw.js` lands in the client output (`.output/public/sw.js`, 9 precache entries for `_next/static/**`). Chrome: registration scope `/`, `navigator.serviceWorker.controller` non-null after reload, `Page.getAppManifest` errors `[]`, `Page.getInstallabilityErrors` `[]` (persistent profile), offline reload served from SW (200). |
| 6 | Docker | PASS | Multi-stage `Dockerfile` (`oven/bun:1.4.2` build → `node:lts-slim` runtime, user `node` uid 1000, `EXPOSE 3000`, `HEALTHCHECK` via `fetch` on `/api/health`). `docker build` + `docker run -p 3000:3000` → health 200, container reports `healthy`. Image 365 MB (OrbStack, arm64). |
| 7 | Upstream rate-limit window | MEASURED | See below. |

### Service-worker workaround

`@serwist/vite`'s own build plugin writes the worker to the top-level `build.outDir` (`dist/`) and globs from there. Under vinext + Nitro the build has four environments (`rsc`, `ssr`, `client`, `nitro`) and client assets land in the `client` environment's outDir (`.output/public` or `.vercel/output/static`). Using the stock plugin produced `dist/sw.js` with 0 precache entries.

Fix: `vite.config.ts` composes Serwist's exported `createContext` / `createApi` / `main` with a small plugin scoped via `applyToEnvironment` to `client`. In that environment's `closeBundle` it points `globDirectory` and `swDest` at the client outDir and calls `api.generateSW()`. It works for both presets with no per-preset config. Serwist's dev plugin is not used; registration (`src/components/service-worker-registration.tsx`) only runs when `NODE_ENV === "production"`.

`vite-plugin-pwa` was not needed and not tried.

### Rate-limit window (darkfanxing `/api/now/{key}`)

`scripts/probe-ratelimit.ts`, run 2026-10-11 08:31:50Z:

- `x-ratelimit-limit: 10`. Requests 1–10 → 200 with `x-ratelimit-remaining` 9…0. No `x-ratelimit-reset` header is sent.
- Request 11 → **429** with `retry-after: 59` (seconds).
- Polling every 10 s while limited: 429 with `retry-after` counting down 49 → 39 → 29 → 19 → 9. Requests made while limited did not extend the window.
- First 200 again at +61.5 s after the first request, with `remaining: 9` (full quota restored at once).

**Conclusion: fixed window of 10 requests per 60 s.** Use `retry-after` on 429 to schedule the retry. There is no reset header, so ingestion should budget ≤ 10 calls per rolling minute itself.

## Findings to carry forward

- **Dev server port moves to 3000.** With `nitro()` added, `vite dev` listens on `http://localhost:3000/` (was 5173).
- **`start` script** changed from `vinext start` (which looks for `dist/` and no longer finds a build) to `node .output/server/index.mjs`.
- **Traced server `node_modules` is ~93 MB.** Nitro force-traces native packages the server bundle imports (`sharp` for `next/image`, `lightningcss`), and the trace pulls in large neighbours (`@typescript/typescript-darwin-arm64` binary, `webpack`, `@ts-morph`). Moving `shadcn` to devDependencies made no difference. Not a blocker; trim later with Nitro `traceDeps: ["!pkg"]` once we know what is actually needed at runtime.
- **Native binaries match the build host.** A local `NITRO_PRESET=vercel` build on macOS bundles darwin-arm64 binaries; deploy Vercel by building in Vercel CI (or Linux), not with `--prebuilt` from a Mac. The Docker build stage runs on Linux, so its output is correct.
- `vinext` treats `_`-prefixed folders as private (Next.js semantics), so the brief's `app/api/_spike/stream` was not routed; the spike used `app/api/spike/stream` (deleted).
- `.vite/manifest.json` and `vinext-client-entry-manifest.json` are emitted into the public output. Harmless, noted.
