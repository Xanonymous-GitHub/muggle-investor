# Foundation & Data Layer Implementation Plan (Phase 0–1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the vinext PWA skeleton with tooling, prove the stack is deployable (Node/k8s + Vercel), and build the data layer that ingests darkfanxing / TWSE / FinMind data into Postgres and serves it through our own BFF.

**Architecture:** One vinext app (Next.js App Router API on Vite). `app/` holds routes; `src/` holds deep modules (`config`, `lib`, `sources`, `db`, `market-clock`, `ingestion`, `market`). Only the ingestion job talks to upstreams; user-facing routes read Postgres snapshots. Every upstream response is parsed → Zod-validated → typed, with raw payload stored.

**Tech Stack:** Bun (package manager + scripts), vinext + Vite + React, Nitro (deploy presets), TypeScript strict, Biome, Zod, Tailwind v4 + shadcn/ui, Drizzle ORM + postgres.js (PGlite in tests), node-html-parser, pino, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-muggle-investor-design.md`

Later plans (not here): Phase 2 market understanding (LLM briefings, glossary, UI), Phase 3 planner, Phase 4 ask-AI + PWA polish.

## Global Constraints

- All dependencies at latest versions; `bunx npm-check-updates` must report nothing to upgrade at the end of every task that adds deps (`bun run deps:check`).
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. No `any` (Biome `noExplicitAny` = error).
- Upstream API key (`DARKFANXING_KEY`) never reaches the client bundle, logs, error messages, or the DB. Upstream base URL `https://stocks.darkfanxing.com`.
- Only ingestion calls upstream; darkfanxing rate limit is `x-ratelimit-limit: 10` per (to-be-measured) window.
- Market time zone is `Asia/Taipei`; trading session 09:00–13:30, data settles after 13:35.
- Trade date of a snapshot comes from the document content, never from the wall clock.
- Never infer next-day direction from 內外盤差 (carried into Phase 2 prompts; noted here because the parsed model keeps the source's caveat text).
- Path alias `@/*` → `./src/*`.

## Review Focus

1. **Key leakage in errors** — a failing fetch must not include the API key in thrown messages or logs (URL contains the key). Test in Task 9.
2. **Intraday / partial digest** — a digest fetched mid-session may lack sections (e.g. 漲跌停 tables, 四象限). Parser must return `null` for optional sections and only fail on title + 大盤. Test in Task 7.
3. **Holiday list contains trading days** — TWSE `holidaySchedule` includes rows like 「國曆新年開始交易日」「農曆春節前最後交易日」 which ARE trading days. Test in Task 12.
4. **Weekend / holiday re-runs** — on non-trading days upstream still returns the last session (e.g. 2026-10-08 on 2026-10-11); ingestion must be idempotent by content trade date and not create duplicates. Test in Task 13.
5. **Placeholder cells** — `—`, empty `<td>`, `無成交` status and empty 漲停鎖死檔數 cells must parse to `null`/`0` consistently rather than `NaN`. Test in Task 5.

---

### Task 1: Project scaffold, tooling and CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vite.config.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `app/layout.tsx`, `app/page.tsx`, `src/lib/.gitkeep`, `test/smoke.test.ts`
- Modify: `.gitignore` (add `.output/`, `dist/`, `.vinext/`, `.env*` except `.env.example`), `README.md` (dev commands)

**Interfaces:**
- Produces: scripts `dev` (`vite dev`), `build` (`vite build`), `start` (`vinext start`), `test` (`vitest run`), `test:watch`, `lint` (`biome check .`), `format` (`biome format --write .`), `typecheck` (`tsc --noEmit`), `deps:check` (`npm-check-updates`), `deps:update` (`npm-check-updates -u && bun install`).

- [ ] **Step 1:** `bun init -y`, then `bun add vinext react react-dom react-server-dom-webpack` and `bun add -d vite @vitejs/plugin-react typescript @types/react @types/react-dom @biomejs/biome vitest npm-check-updates`. Do not add `@vitejs/plugin-rsc` (vinext registers it).
- [ ] **Step 2:** `vite.config.ts` = `defineConfig({ plugins: [vinext()], resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } } })`. `vitest.config.ts` is separate (no vinext plugin), same alias, `include: ["test/**/*.test.ts", "src/**/*.test.ts"]`, `environment: "node"`.
- [ ] **Step 3:** `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `paths: { "@/*": ["./src/*"] }`. `biome.json`: recommended rules, `noExplicitAny: error`, formatter 2-space, line width 100, ignore `.output`, `test/fixtures`.
- [ ] **Step 4:** Minimal `app/layout.tsx` (`<html lang="zh-Hant">`) and `app/page.tsx` rendering `<h1>Muggle Investor</h1>`.
- [ ] **Step 5:** `test/smoke.test.ts`: `expect(1 + 1).toBe(2)` plus an import via `@/` alias of a trivial `src/lib/version.ts` exporting `APP_NAME = "Muggle Investor"`; assert equality.
- [ ] **Step 6:** Run `bun run deps:update`, then `bun run lint && bun run typecheck && bun run test && bun run build`. Expected: all pass; `bun run dev` serves the heading (curl the URL printed by the dev server and grep "Muggle Investor"). Use that same base URL wherever later tasks say `localhost:5173`.
- [ ] **Step 7:** `.github/workflows/ci.yml`: on push/PR → `oven-sh/setup-bun@v2`, `bun install --frozen-lockfile`, `bunx biome ci .`, `bun run typecheck`, `bun run test`, `bun run build`.
- [ ] **Step 8:** Commit `chore: scaffold vinext app with bun, biome, vitest and CI`.

### Task 2: Tailwind v4 + shadcn/ui

**Files:**
- Create: `app/globals.css`, `components.json`, `src/components/ui/button.tsx` (via shadcn CLI), `src/lib/utils.ts` (`cn`)
- Modify: `vite.config.ts` (add `@tailwindcss/vite`), `app/layout.tsx` (import globals.css), `app/page.tsx` (render `<Button>`)

- [ ] **Step 1:** `bun add -d tailwindcss @tailwindcss/vite`; add plugin to `vite.config.ts`; `globals.css` = `@import "tailwindcss";`.
- [ ] **Step 2:** `bunx shadcn@latest init` (style: new-york, base color: neutral, aliases `@/components`, `@/lib/utils`), then `bunx shadcn@latest add button`. If the CLI cannot detect vinext, choose the "Vite" framework option and fix aliases to the `@/*` → `src/*` mapping.
- [ ] **Step 3:** Verify: `bun run build` passes and `bun run dev` page HTML contains a `<button` with Tailwind classes; `bun run lint && bun run typecheck` pass; `bun run deps:check` clean.
- [ ] **Step 4:** Commit `chore: add tailwind v4 and shadcn/ui`.

### Task 3: Feasibility spike — Nitro presets, streaming, service worker, Bun runtime, rate-limit window

Go/no-go gate for vinext. **If any of checks 2–5 fail without a workaround, stop and report to the user with the fallback proposal (Next.js 16, same app code).**

**Files:**
- Create: `app/api/health/route.ts`, `app/api/_spike/stream/route.ts` (deleted at end of task), `public/manifest.webmanifest`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, service-worker source per chosen integration, `Dockerfile`, `.dockerignore`, `scripts/probe-ratelimit.ts`, `docs/spikes/2026-10-11-vinext-feasibility.md`
- Modify: `vite.config.ts` (add `nitro()` from `nitro/vite`), `app/layout.tsx` (manifest link, theme-color)

**Interfaces:**
- Produces: `GET /api/health` → `200 {"status":"ok","app":"muggle-investor"}`; Docker image runs `node .output/server/index.mjs` on port 3000.

- [ ] **Step 1:** `bun add -d nitro`; add `nitro()` after `vinext()`. Health route returns the JSON above.
- [ ] **Step 2 — Node preset:** `NITRO_PRESET=node bun run build && node .output/server/index.mjs` → `curl localhost:3000/api/health` returns the JSON. Also run `bun .output/server/index.mjs` and record whether Bun works as the runtime.
- [ ] **Step 3 — Vercel preset:** `NITRO_PRESET=vercel bun run build` succeeds and produces `.vercel/output/config.json` (or `.output` per Nitro docs); record the path.
- [ ] **Step 4 — Streaming:** spike route returns a `ReadableStream` emitting `chunk-1..chunk-5` 300 ms apart (`text/plain`). `curl -N` against the Node build shows chunks arriving incrementally (timestamps differ ≥ 1 s first→last). Also verify an AI-SDK-style SSE response header (`content-type: text/event-stream`) passes through un-buffered.
- [ ] **Step 5 — Service worker:** try `@serwist/vite` first, fall back to `vite-plugin-pwa` (`injectManifest` or `generateSW`). Pass = built output contains `sw.js`, page registers it, Chrome (Playwright, `executablePath` if needed) reports `navigator.serviceWorker.controller` non-null after reload, manifest parsed (installable).
- [ ] **Step 6 — Docker:** multi-stage `Dockerfile` (`oven/bun` build stage running `NITRO_PRESET=node bun run build`, `node:lts-slim` runtime copying `.output`, non-root user, `EXPOSE 3000`, `HEALTHCHECK` on `/api/health`). `docker build -t muggle-investor . && docker run -p 3000:3000` → health 200.
- [ ] **Step 7 — Rate-limit window:** `scripts/probe-ratelimit.ts` (reads `DARKFANXING_KEY` from env) calls `/api/now/{key}` up to 11 times, logging `x-ratelimit-*` headers and status with timestamps; then polls once every 10 s until `remaining` recovers. Record limit, window length, and 429 behavior. Never print the key.
- [ ] **Step 8:** Write `docs/spikes/2026-10-11-vinext-feasibility.md`: table of checks 2–7 with result, workaround, chosen SW integration, measured rate-limit window, and the go/no-go call. Delete `app/api/_spike/`.
- [ ] **Step 9:** `bun run lint && bun run typecheck && bun run test && bun run build` pass; `deps:check` clean. Commit `chore: add nitro deploy presets, PWA shell, health check and feasibility report`.

### Task 4: Config and logger

**Files:**
- Create: `src/config/env.ts`, `src/lib/logger.ts`, `.env.example`
- Test: `src/config/env.test.ts`

**Interfaces:**
- Produces:
  - `envSchema` (Zod) and `type Env = z.infer<typeof envSchema>`.
  - `parseEnv(source: Record<string, string | undefined>): Env` — throws `EnvError` listing every invalid key (names only, never values).
  - `getEnv(): Env` — memoized `parseEnv(process.env)`; server-only.
  - `logger` — pino instance, `level` from `LOG_LEVEL`, `redact: ["*.key", "*.apiKey", "*.token", "headers.authorization", "url"]`.
- Fields: `DATABASE_URL` (url), `DARKFANXING_BASE_URL` (url, default `https://stocks.darkfanxing.com`), `DARKFANXING_KEY` (min 16), `FINMIND_TOKEN` (optional), `LLM_BASE_URL` (url), `LLM_API_KEY` (string), `LLM_MODEL` (string), `CRON_SECRET` (min 32), `INVITE_CODES` (comma list → `string[]`, min 1), `LOG_LEVEL` (enum, default `info`).

- [ ] **Step 1: Failing tests** — `parseEnv` with a full valid object returns typed values and `INVITE_CODES: "a,b"` → `["a","b"]`; missing `DARKFANXING_KEY` and short `CRON_SECRET` → throws `EnvError` whose `message` contains both key names and does NOT contain the supplied secret values; `DARKFANXING_BASE_URL` defaults correctly.
- [ ] **Step 2:** Run `bun run test src/config` → FAIL.
- [ ] **Step 3:** Implement. `bun add zod pino`.
- [ ] **Step 4:** Tests PASS; `.env.example` lists every key with placeholder values.
- [ ] **Step 5:** Commit `feat(config): validated env schema and logger`.

### Task 5: Shared parsing primitives

**Files:**
- Create: `src/sources/shared/parse-values.ts`
- Test: `src/sources/shared/parse-values.test.ts`

**Interfaces:**
- Produces:
  - `parseNumber(text: string): number | null` — trims, strips `,` `%` `+`, handles `−`/`-`; returns `null` for `""`, `—`, `-` alone, `無成交`.
  - `parseCount(text: string): number` — like `parseNumber` but empty → `0` (used for 漲停/跌停鎖死檔數 cells).
  - `parseTriple(text: string): [number, number, number]` — `"4/1/0"` → `[4,1,0]`.
  - `parsePair(text: string): [number, number]` — `"69/101"` → `[69,101]`.
  - `parseRocDate(text: string): string` — `"115/09/01"` and `"1150101"` → `"2026-09-01"` / `"2026-01-01"` (ISO date).
  - `parseStockLabel(text: string): { name: string; code: string }` — `"安碁 6174"` → `{ name: "安碁", code: "6174" }`; `"騰輝電子-KY 6672"` handled.
  - `parseMovers(text: string): { name: string; changePct: number }[]` — `"染料，顏料 +4.3、不織布 +3.5"` → two entries (names may contain `，` and `／`; split on `、` then take trailing signed number).

- [ ] **Step 1: Failing tests** with exactly the examples above, plus `parseNumber("+5.97")===5.97`, `parseNumber("-619")===-619`, `parseNumber("10,465.0")===10465`, `parseNumber("—")===null`, `parseCount("")===0`, `parseMovers("")` → `[]`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(sources): shared value parsers`.

### Task 6: Generic report-document parser

**Files:**
- Create: `src/sources/darkfanxing/report-document.ts`
- Test: `src/sources/darkfanxing/report-document.test.ts` (uses `test/fixtures/darkfanxing/*.html`)

**Interfaces:**
- Produces:
  ```ts
  type ReportTable = { headers: string[]; rows: string[][] };
  type ReportSection = { heading: string; level: 2 | 3; items: string[]; paragraphs: string[]; tables: ReportTable[] };
  type ReportDocument = { title: string; intro: string[]; sections: ReportSection[]; text: string };
  function parseReportDocument(html: string): ReportDocument;
  function findSection(doc: ReportDocument, headingPrefix: string): ReportSection | undefined;
  ```
  `intro` = `<p>` text before the first `<h2>` (split on `<br>`). Each `<h2>`/`<h3>` opens a new section collecting following `<li>`, `<p>`, `<table>` until the next heading. `text` = whole document as plain text (for LLM context in Phase 2). Cell/heading text is HTML-unescaped and trimmed.

- [ ] **Step 1: Failing tests:** digest fixture → `title === "台股盤面摘要 2026-10-08（收盤後）"`, 12 sections (9 × h2 + 3 × h3), `findSection(doc,"盤中節奏")!.tables[0].headers` equals `["時間","上漲/下跌族群","力度%","面積%","當時領漲","當時領跌"]` with 6 rows, `findSection(doc,"漲停鎖死中")!.level === 3`; now fixture → one table with 175 rows and 11 headers; group fixture → 5 rows, first row `["安碁 6174","+9.97","6.37","+90.4","+59.0",""]`.
- [ ] **Step 2:** FAIL. **Step 3:** `bun add node-html-parser`; implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(darkfanxing): generic report document parser`.

### Task 7: Typed darkfanxing parsers (sector board, sector detail, digest)

**Files:**
- Create: `src/sources/darkfanxing/schemas.ts`, `src/sources/darkfanxing/parse-sector-board.ts`, `src/sources/darkfanxing/parse-sector-detail.ts`, `src/sources/darkfanxing/parse-digest.ts`, `src/sources/darkfanxing/parse-title.ts`
- Test: one `*.test.ts` per parser, same directory

**Interfaces:**
- Consumes: `parseReportDocument`, `findSection` (Task 6); value parsers (Task 5).
- Produces (Zod schemas in `schemas.ts`, types inferred; every parser returns `schema.parse(result)`):
  - `parseTitle(title: string): { tradeDate: string; asOf: string | null; session: "closed" | "intraday" }` — `"（收盤後）"` → `closed`, otherwise `intraday`; `asOf` = `HH:MM` if present.
  - `parseSectorBoard(html: string): SectorBoard` — `{ tradeDate, asOf, session, marketTurnover: { today: number; prevSameTime: number; changePct: number } | null, sectors: SectorRow[] }`; `SectorRow = { rank, name, changePct, advancers, decliners, unchanged, constituents, turnover, turnoverRank, turnoverVsPrevPct: number | null, limitUp, limitDown, change1mPct: number | null }`. `marketTurnover` regex on intro: `全市場成分股合計成交 ([\d.,]+) 億（前一交易日同時刻 ([\d.,]+) 億，([+-][\d.]+)%）`.
  - `parseSectorDetail(html: string): SectorDetail` — `{ group, tradeDate, asOf, changePct, rank, rankOf, change1mPct, stocks: { name, code, changePct, turnover, turnoverVsPrevPct: number | null, change1mPct: number | null, noTrade: boolean }[] }` (`noTrade` = status cell contains `無成交`; group/rank parsed from intro `族群今日 +3.93%（漲跌幅排名 2/175）、近 1 月 +31.7%`).
  - `parseDigest(html: string): DigestSnapshot` —
    ```ts
    {
      tradeDate, asOf, session,
      market: { futures: { open, high, low, close, change, changePct } | null,
                upGroups, downGroups, force, breadth,
                prev: { upGroups, downGroups, force, breadth } | null },
      rhythm: { time; upGroups; downGroups; force; breadth; leaders: Mover[]; laggers: Mover[] }[],
      topGainers: SectorMover[] | null, topLosers: SectorMover[] | null,   // 今日%、近1月%、檔數、上漲家數比%、漲停鎖死、跌停鎖死、代表個股(Mover[])
      netBuy: FlowRow[] | null, netSell: FlowRow[] | null,                  // 內外盤金額差、前一日、成交金額、占全市場%、集中倍數、今日%
      quadrant: { counts: { today: QuadrantCounts; prev: QuadrantCounts | null };
                  transitions: { name; from: Quadrant; to: Quadrant; slope5d; slope20d; netFlowToday }[];
                  leaders: { label: string; entries: { name; slope5d; slope20d; quadrant: Quadrant }[] }[] } | null,
      limits: { summary: string[]; tables: ReportSection[] } | null,
      glossary: { term: string; definition: string }[],
      caveats: string[],   // intro sentences, kept verbatim (contains the 內外盤差 warning)
    }
    type Quadrant = "強勢" | "弱勢" | "轉強" | "轉弱";
    ```
    Required: title, 大盤 (`force`, `breadth`, `upGroups`, `downGroups`). Everything marked `| null` is optional — missing section → `null`, never throw. Glossary items split on the first `：`.

- [ ] **Step 1: Failing tests — sector board** (now fixture): 175 sectors; `sectors[0]` = `{ rank:1, name:"不織布", changePct:5.97, advancers:4, decliners:1, unchanged:0, constituents:5, turnover:2.3, turnoverRank:128, turnoverVsPrevPct:146.8, limitUp:0, limitDown:0, change1mPct:9.3 }`; last sector name `"矽晶圓"` changePct `-3.36`; `marketTurnover` = `{ today:10465, prevSameTime:11500.4, changePct:-9 }`; `tradeDate "2026-10-08"`, `asOf "13:34"`, `session "closed"`.
- [ ] **Step 2: Failing tests — sector detail** (group fixture): `group "石英元件"`, `changePct 3.93`, `rank 2`, `rankOf 175`, `change1mPct 31.7`, 5 stocks, first `{ name:"安碁", code:"6174", changePct:9.97, turnover:6.37, turnoverVsPrevPct:90.4, change1mPct:59, noTrade:false }`. Add an inline HTML case with status `無成交` → `noTrade: true`.
- [ ] **Step 3: Failing tests — digest** (digest fixture): `market.futures.close 49349`, `change -619`, `changePct -1.24`; `upGroups 87`, `downGroups 88`, `force -0.63`, `breadth 0.2`; `prev` = `{120,53,1.38,0.91}`; `rhythm.length 6`, `rhythm[0].leaders[0]` = `{ name:"染料，顏料", changePct:4.3 }`; `topGainers[0].name "不織布"`, `topLosers[0].name "矽晶圓"`; `netBuy[0]` name `"被動元件"` net `57.44`; `netSell[0]` `"軸承／滑軌"` `-104.13`; quadrant counts today `{強勢:43,弱勢:78,轉強:25,轉弱:29}`; first transition `車用電子 強勢→轉弱 -27.59/+13.12/-77.58`; 4 leader groups, first entry `印刷電路板上游與材料 +111.3/+21.4 強勢`; `glossary.length >= 9` incl. term `"力度"`; `caveats` joined contains `"請勿據此推論明日走勢"`.
- [ ] **Step 4: Failing test — partial digest (Review Focus #2):** build HTML from the fixture with the 四象限, 漲跌停 and 資金 sections removed → `quadrant`, `limits`, `netBuy`, `netSell` are `null`, no throw. Removing `大盤` → throws `DarkfanxingParseError` naming the section.
- [ ] **Step 5:** Run → FAIL. **Step 6:** Implement (one parser per file; schema shared). **Step 7:** Run → PASS.
- [ ] **Step 8:** Commit `feat(darkfanxing): typed parsers for digest, sector board and sector detail`.

### Task 8: HTTP utilities — rate limiter and retrying fetch

**Files:**
- Create: `src/lib/rate-limiter.ts`, `src/lib/http.ts`
- Test: `src/lib/rate-limiter.test.ts`, `src/lib/http.test.ts`

**Interfaces:**
- Produces:
  - `createRateLimiter(opts: { capacity: number; refillEveryMs: number; now?: () => number; sleep?: (ms: number) => Promise<void> }): RateLimiter` where `type RateLimiter = { acquire(): Promise<void> }` — token bucket; refills to full every `refillEveryMs` (window semantics matching upstream).
  - `fetchWithRetry(url: string, init: RequestInit & { retries?: number; baseDelayMs?: number; timeoutMs?: number; fetchImpl?: typeof fetch; sleep?: ... ; redact?: (url: string) => string }): Promise<Response>` — retries on network error, 429 (respects `retry-after` seconds), 5xx; default `retries 3`, `baseDelayMs 500` exponential, `timeoutMs 15000`. Throws `HttpError { status: number | null; url: string /* redacted */ }`.

- [ ] **Step 1: Failing tests:** limiter with capacity 2 / 1000 ms: third `acquire` waits until fake clock advances 1000 ms. Retry: fake fetch returning 503, 503, 200 → resolves after 2 sleeps of 500 and 1000; 429 with `retry-after: 2` → sleeps 2000; 404 → throws immediately, no retry; final error message uses `redact(url)`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(lib): token-bucket rate limiter and retrying fetch`.

### Task 9: darkfanxing client

**Files:**
- Create: `src/sources/darkfanxing/client.ts`, `src/sources/darkfanxing/index.ts` (public exports)
- Test: `src/sources/darkfanxing/client.test.ts`

**Interfaces:**
- Consumes: Task 7 parsers, Task 8 `createRateLimiter`, `fetchWithRetry`, Task 4 `Env`.
- Produces:
  ```ts
  type Fetched<T> = { raw: string; parsed: T | null; parseError: string | null; fetchedAt: Date };
  interface DarkfanxingClient {
    fetchDigest(): Promise<Fetched<DigestSnapshot>>;
    fetchSectorBoard(): Promise<Fetched<SectorBoard>>;
    fetchSectorDetail(group: string): Promise<Fetched<SectorDetail>>;
  }
  function createDarkfanxingClient(opts: { baseUrl: string; key: string; limiter: RateLimiter; fetchImpl?: typeof fetch }): DarkfanxingClient;
  ```
  URLs: `${baseUrl}/api/digest/${key}`, `${baseUrl}/api/now/${key}`, `${baseUrl}/api/now/${key}?group=${encodeURIComponent(group)}`. Parse errors are captured into `parseError` (raw still returned); HTTP errors throw. Limiter capacity/window come from the Task 3 spike report.

- [ ] **Step 1: Failing tests** with a fake fetch serving fixtures: `fetchSectorBoard()` → `parsed.sectors.length === 175`; `fetchSectorDetail("石英元件")` requests URL ending `?group=%E7%9F%B3%E8%8B%B1%E5%85%83%E4%BB%B6`; fake returning `<html>garbage</html>` → `parsed null`, `parseError` non-empty; **(Review Focus #1)** fake returning 500 always → rejected `HttpError` whose `message` and `url` do not contain the key and do contain `/api/now/***`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(darkfanxing): rate-limited client`.

### Task 10: FinMind and TWSE adapters

**Files:**
- Create: `src/sources/finmind/client.ts`, `src/sources/finmind/schemas.ts`, `src/sources/twse/client.ts`, `src/sources/twse/schemas.ts`
- Create fixtures (capture with curl, commit): `test/fixtures/finmind/price-0050-2026-09.json`, `dividend-result-0050.json`, `split-0050.json`; `test/fixtures/twse/holiday-schedule.json`
- Test: `src/sources/finmind/client.test.ts`, `src/sources/twse/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type PriceBar = { symbol: string; date: string; open: number; high: number; low: number; close: number; volume: number };
  type CorporateAction = { symbol: string; exDate: string; kind: "dividend" | "split"; beforePrice: number; afterPrice: number; cashDividend: number | null };
  interface FinMindClient {
    fetchPrices(symbol: string, start: string, end: string): Promise<PriceBar[]>;        // dataset TaiwanStockPrice
    fetchCorporateActions(symbol: string, start: string): Promise<CorporateAction[]>;   // TaiwanStockDividendResult + TaiwanStockSplitPrice, merged, sorted by exDate
  }
  function createFinMindClient(opts: { token?: string; limiter: RateLimiter; fetchImpl?: typeof fetch }): FinMindClient;
  type MarketHoliday = { date: string; name: string; isTradingDay: boolean };
  interface TwseClient { fetchHolidaySchedule(): Promise<MarketHoliday[]> }   // openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule
  function createTwseClient(opts: { limiter: RateLimiter; fetchImpl?: typeof fetch }): TwseClient;
  ```
  FinMind: base `https://api.finmindtrade.com/api/v4/data`, `token` as `Authorization: Bearer` header only when set; response `status !== 200` → throw. Price fields map `max→high`, `min→low`, `Trading_Volume→volume`. Dividend result: `before_price`, `after_price`, `stock_and_cache_dividend` (cash when `stock_or_cache_dividend === "息"`). Split: `before_price`, `after_price`.
  TWSE holiday: `Date` ROC `1150101` → ISO; `isTradingDay = /開始交易|最後交易/.test(Name)`.

- [ ] **Step 1:** Capture fixtures:
  `curl "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=0050&start_date=2026-09-01&end_date=2026-09-30"`, `...dataset=TaiwanStockDividendResult&data_id=0050&start_date=2025-01-01`, `...dataset=TaiwanStockSplitPrice&data_id=0050&start_date=2024-01-01`, `curl https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule`.
- [ ] **Step 2: Failing tests:** price 2026-09-01 bar = `{ open:106.5, high:108.7, low:106.5, close:108.45, volume:111066980 }`; corporate actions include `{ exDate:"2025-06-18", kind:"split", beforePrice:188.65, afterPrice:47.16, cashDividend:null }` and `{ exDate:"2025-07-21", kind:"dividend", beforePrice:51.45, afterPrice:51.09, cashDividend:0.36 }`, sorted ascending; **(Review Focus #3)** holidays: `2026-01-01` `isTradingDay false`, `2026-01-02` (「國曆新年開始交易日」) `isTradingDay true`, `2026-02-12` (結算交割作業) `false`; FinMind `{"status":402,...}` → throws.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat(sources): finmind and twse adapters`.

### Task 11: Database schema, migrations and repositories

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/repositories/snapshots.ts`, `src/db/repositories/prices.ts`, `src/db/repositories/calendar.ts`, `drizzle.config.ts`, `drizzle/` (generated), `docker-compose.yml` (postgres:latest for dev), `test/helpers/test-db.ts`
- Test: `src/db/repositories/*.test.ts`

**Interfaces:**
- Produces:
  - Tables:
    - `market_snapshots` (`id` uuid pk, `kind` enum `digest|sector_board|sector_detail`, `group_name` text null, `trade_date` date, `as_of` text null, `session` text, `captured_at` timestamptz, `raw_html` text, `parsed` jsonb null, `parse_error` text null, `parser_version` int). Unique `(kind, coalesce(group_name,''), trade_date, as_of)`.
    - `price_bars` (pk `symbol, date`; numeric OHLC as `double precision`; `volume` bigint).
    - `corporate_actions` (pk `symbol, ex_date, kind`; `before_price`, `after_price`, `cash_dividend` null).
    - `market_holidays` (pk `date`; `name`, `is_trading_day` bool).
  - `createDb(url: string)` → Drizzle instance (postgres.js); `type Db`.
  - Snapshots repo: `saveSnapshot(db, s: NewSnapshot): Promise<{ inserted: boolean }>` (on conflict do nothing), `latestSnapshot(db, kind, opts?: { groupName?: string; parsedOnly?: boolean }): Promise<Snapshot | null>`, `hasSnapshot(db, kind, tradeDate, opts?: { session?: "closed" }): Promise<boolean>`.
  - Prices repo: `upsertPriceBars(db, bars: PriceBar[])`, `upsertCorporateActions(db, actions)`, `latestPriceDate(db, symbol): Promise<string | null>`, `getPriceBars(db, symbol, start, end)`.
  - Calendar repo: `replaceHolidays(db, holidays: MarketHoliday[])`, `getHolidays(db, year: number)`.
  - `test/helpers/test-db.ts`: `createTestDb(): Promise<Db>` using PGlite + `migrate` from the generated `drizzle/` folder.
- [ ] **Step 1:** `bun add drizzle-orm postgres`, `bun add -d drizzle-kit @electric-sql/pglite`. Scripts `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`).
- [ ] **Step 2: Failing tests:** saving the same snapshot twice → second `{ inserted:false }`; `latestSnapshot("sector_board")` returns newest by `captured_at`; `parsedOnly` skips rows with `parsed null`; upserting a price bar twice with changed close keeps one row with new close; `latestPriceDate` returns max date; holidays round-trip with `isTradingDay`.
- [ ] **Step 3:** FAIL. **Step 4:** Implement schema, `bun run db:generate`, repositories. **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat(db): schema, migrations and repositories`.

### Task 12: Market clock

**Files:**
- Create: `src/market-clock/market-clock.ts`
- Test: `src/market-clock/market-clock.test.ts`

**Interfaces:**
- Produces:
  - `toTaipei(now: Date): { date: string; minutes: number; weekday: number }` (via `Intl.DateTimeFormat` with `Asia/Taipei`).
  - `isTradingDay(date: string, holidays: MarketHoliday[]): boolean` — weekend → false unless a holiday row says `isTradingDay` (makeup trading day); holiday row with `isTradingDay false` → false.
  - `marketPhase(now: Date, holidays: MarketHoliday[]): "closed-day" | "pre-open" | "intraday" | "settling" | "post-close"` — boundaries (Taipei): `< 09:00` pre-open, `09:00–13:34` intraday, `13:35–13:59` settling, `>= 14:00` post-close.

- [ ] **Step 1: Failing tests:** `2026-10-11` (Sunday) → `closed-day`; `2026-10-08T01:00:00Z` (09:00 Taipei) → `intraday`; `05:34Z` → `intraday`; `05:35Z` → `settling`; `06:00Z` → `post-close`; `2026-01-01` with holiday fixture → `closed-day`; `2026-01-02` → trading day.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(market-clock): trading day and session phase`.

### Task 13: Ingestion job and cron endpoint

**Files:**
- Create: `src/ingestion/run-ingestion.ts`, `src/ingestion/tracked-symbols.ts`, `app/api/cron/ingest/route.ts`, `src/lib/auth/bearer.ts`
- Test: `src/ingestion/run-ingestion.test.ts`, `src/lib/auth/bearer.test.ts`

**Interfaces:**
- Consumes: Tasks 9–12.
- Produces:
  - `TRACKED_SYMBOLS: readonly string[] = ["0050", "006208"]` (Phase 3 replaces with instrument list).
  - `runIngestion(deps: { db: Db; darkfanxing: DarkfanxingClient; finmind: FinMindClient; twse: TwseClient; now: Date; logger: Logger }): Promise<IngestionReport>` where `IngestionReport = { phase; actions: { name: string; status: "done" | "skipped" | "failed"; detail?: string }[] }`.
    - Every run: refresh holidays if current year missing.
    - `intraday` | `settling`: fetch sector board → save.
    - `post-close`: if no `closed` digest for the **content** trade date → fetch digest + sector board → save; else skip. Then for each tracked symbol fetch prices from `latestPriceDate+1` (or `2010-01-01` initial backfill) to today and corporate actions; upsert.
    - `closed-day` / `pre-open`: only the post-close catch-up (digest for last session if missing) and prices.
    - A failure in one action is recorded as `failed` and does not abort the others; parse errors still save raw.
  - `verifyBearer(header: string | null, secret: string): boolean` — `crypto.timingSafeEqual` on equal-length buffers.
  - `POST /api/cron/ingest` (also accept `GET` for Vercel Cron): 401 unless bearer valid; returns `IngestionReport` JSON.

- [ ] **Step 1: Failing tests** with PGlite + fake clients: post-close run saves 1 digest + 1 board; second identical run → digest action `skipped` (no duplicate rows); **(Review Focus #4)** run at `2026-10-11` (Sunday) when upstream serves the 2026-10-08 fixture and it's already stored → nothing new inserted; intraday run saves only sector board; FinMind throwing → that action `failed`, digest still saved; bearer: correct → true, wrong/missing/different length → false.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Manual check: `docker compose up -d`, `bun run db:migrate`, `bun run dev`, `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:5173/api/cron/ingest` → report JSON; `psql` shows rows. Without header → 401.
- [ ] **Step 6:** Commit `feat(ingestion): scheduled ingestion job and cron endpoint`.

### Task 14: Market read API

**Files:**
- Create: `src/market/market-service.ts`, `app/api/market/today/route.ts`, `app/api/market/sectors/route.ts`, `app/api/market/sectors/[group]/route.ts`
- Test: `src/market/market-service.test.ts`

**Interfaces:**
- Consumes: snapshots repo, `DarkfanxingClient`, `marketPhase`.
- Produces:
  - `getToday(db): Promise<{ digest: DigestSnapshot | null; board: SectorBoard | null; stale: boolean }>` — latest parsed snapshots; `stale` true when board trade date < digest trade date.
  - `getSectorBoard(db): Promise<SectorBoard | null>`.
  - `getSectorDetail(deps: { db; darkfanxing; now; holidays }, group: string): Promise<SectorDetail | null>` — return cached snapshot if (`intraday` and captured < 5 min ago) or (not intraday and same trade date as latest board); otherwise fetch via client, save, return. Unknown group (not in latest board) → `null` without calling upstream.
  - Routes return JSON; `[group]` → 404 when `null`. `Cache-Control: no-store` for intraday, `s-maxage=300` otherwise.

- [ ] **Step 1: Failing tests:** cached detail within 5 min intraday → fake client not called; 6 min → called once and saved; post-close with same-date snapshot → not called; group `"不存在"` → `null`, client not called.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Verify end-to-end against dev DB after a manual ingest: `curl localhost:5173/api/market/today | jq '.digest.market.force'` → number; `curl localhost:5173/api/market/sectors/%E7%9F%B3%E8%8B%B1%E5%85%83%E4%BB%B6 | jq '.stocks|length'` → number.
- [ ] **Step 6:** Final gate: `bun run lint && bun run typecheck && bun run test && bun run build && bun run deps:check` all clean. Commit `feat(market): read API for today, sectors and sector detail`.
