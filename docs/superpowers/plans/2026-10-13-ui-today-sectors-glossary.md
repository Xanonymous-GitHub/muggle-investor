# Phase 2B UI (Today, Sectors, Glossary, Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the installable PWA screens for market understanding: Today (verdict + "while you were away"), Sectors, Glossary, Settings, responsive from phone to desktop, light and dark.

**Architecture:** Client components under `src/ui/**` fetch the existing public JSON routes through one cache-backed `useResource` hook (stale-while-revalidate in `localStorage`, versioned). All screen logic that decides what to show lives in pure view-model functions (unit-tested without a DOM); components only render them. Device state (lens, theme, last seen trade date) lives in `localStorage` behind a safe wrapper. One small backend change: the recap's cumulative futures figure reuses the weekly continuity guard.

**Tech Stack:** vinext App Router, React 19, TypeScript, Tailwind v4, shadcn/ui (radix-nova) + lucide-react, Zod, Vitest (+ happy-dom, Testing Library for components), Serwist, Biome, Bun.

**Spec:** `docs/superpowers/specs/2026-10-13-muggle-investor-ui-design.md` (also read `docs/superpowers/specs/2026-10-11-muggle-investor-design.md` for product context). Mockups the user approved: https://claude.ai/artifact/6CtAuEBDNU31Qb1TA6DYpe (Today, phone and desktop) and https://claude.ai/artifact/Tg3pZNMf4rszfdw5yi2keC (Sectors). Their numbers are illustrative.

## Global Constraints

- Stack: vinext, TypeScript (strict), Bun, Biome, shadcn/ui, Zod. All dependencies at their latest version (`bun run deps:check` must report nothing outdated). Add shadcn components with the shadcn CLI, never hand-copied.
- UI copy is Traditional Chinese (`lang="zh-Hant"`). System font stack only, no web fonts.
- Colour convention: red = up, green = down (Taiwan). Every up/down figure also carries a `+`/`-` sign; colour is never the only signal. Tokens `--up`/`--down` exist for both themes.
- Every datum shows its data date. Old data is never presented as today's. Offline shows `目前離線，顯示的是上次載入的資料。`
- The UI never calls an LLM and never invents text. LLM text (headline, summary, sections, takeaway) comes from stored briefings; everything else is deterministic.
- The 今天 tab always ends with the fixed line `以上為資料整理與教育說明，不構成投資建議。` (ruling T6-b: the UI, not the LLM, owns it).
- The lens (`beginner` | `pro`, type `Lens` from `@/insight/lens`) and theme live in Settings only. There is no lens switch on the Today page.
- Navigation shows exactly three destinations: 今日 `/`, 族群 `/sectors`, 名詞 `/glossary`, plus Settings `/settings` (gear). No 規劃 or 問問看.
- No secrets or `.env` values in code, logs or tests. The UI only calls same-origin `/api/*` GET routes.
- Dates are `YYYY-MM-DD` trade dates; weekday labels computed in UTC from that string (no local time zone use).
- Components are tested in the `dom` Vitest project (`src/ui/**/*.test.tsx`); pure functions in the `node` project. Biome clean, `tsc --noEmit` clean, no console noise in test output.

## Review Focus

- Settings in `localStorage` are corrupt, missing, or storage throws (private window): defaults apply (`beginner`, `system`), nothing crashes, a write failure is silent. (Task 4)
- First visit, no last-seen date, and offline with nothing cached: Today shows a designed empty state, not a spinner forever and not an exception. (Tasks 5, 9)
- Latest briefing is older than the latest digest, or absent, or 404: numbers show, the headline is never labelled as today's. (Task 9)
- Digest with `futures: null`, `quadrant: null`, `netBuy: null`, or an empty board: tiles and cards omit what is missing, no `NaN`, no `undefined` text. (Tasks 9, 11)
- Sector names containing `／`, spaces or ASCII (`軸承／滑軌`, `MCU`) round-trip through `?group=`; detail 404 and 503 (`busy`, with `retry-after`) show their own messages. (Task 13)
- A recap 503 (`unavailable`) or 400 never blanks Today; the away tab is simply absent. (Task 10)

---

## File Structure

- Backend: `src/market/futures-chain.ts` (new, shared guard), `src/insight/facts-weekly.ts` and `src/recap/recap-service.ts` (use it).
- Shell: `app/layout.tsx` (modify), `app/(app)/layout.tsx`, `app/(app)/{page,sectors/page,glossary/page,settings/page}.tsx` (thin wrappers around `src/ui` screens), `app/globals.css` (tokens).
- `src/ui/theme/`, `src/ui/device/`, `src/ui/data/`, `src/ui/shell/`, `src/ui/settings/`, `src/ui/glossary/`, `src/ui/today/`, `src/ui/sectors/`, `src/ui/format.ts`.
- Tests sit beside the code (`*.test.ts` / `*.test.tsx`).

---

### Task 1: Share the futures continuity guard and apply it to the recap

**Files:**
- Create: `src/market/futures-chain.ts`, `src/market/futures-chain.test.ts`
- Modify: `src/insight/facts-weekly.ts`, `src/recap/recap-service.ts`, `src/recap/recap-service.test.ts`

**Interfaces:**
- Produces: `futuresChainBreaks(days: readonly { tradeDate: string; futures: { close: number; change: number } | null }[]): boolean` — days sorted ascending; true when two consecutive entries that both have futures are adjacent weekdays and `|close − change − previousClose| > 0.5`. Non-adjacent pairs are not checked. Also exports `nextWeekday(date: string): string`.

- [ ] **Step 1: Write failing tests** (`futures-chain.test.ts`): chained Mon→Tue is `false`; Mon→Tue with a 1,349-point gap is `true`; Fri→Mon adjacent and chained is `false`; Mon→Thu (not adjacent) is `false`; a day with `futures: null` between two days breaks nothing; 0.5 gap `false`, 0.6 gap `true`. In `recap-service.test.ts`: a recap whose stored digests do not chain returns `cumulative.futuresChangePct === null`; chained digests return the existing number.
- [ ] **Step 2: Run to verify failure:** `bunx vitest run src/market/futures-chain.test.ts src/recap` → FAIL (module missing / assertion).
- [ ] **Step 3: Implement.** Move `nextWeekday`/weekday helpers and the chain test out of `facts-weekly.ts` into `futures-chain.ts` (weekly keeps `hasSettlementDay`); `facts-weekly.ts` calls `futuresChainBreaks` mapping digests to `{tradeDate, futures: market.futures}`. In `recap-service.ts` make the cumulative function take all digests of the span and return `null` when the chain breaks (keep the existing first/last math otherwise).
- [ ] **Step 4: Run** `bunx vitest run src/market src/insight src/recap` → PASS (existing weekly tests unchanged).
- [ ] **Step 5: Commit** `fix(recap): withhold the cumulative futures change when adjacent days do not chain`.

### Task 2: Test infrastructure and shadcn components

**Files:**
- Modify: `package.json`, `bun.lock`, `vitest.config.ts`
- Create: `src/ui/test/setup.ts`, `src/ui/test/smoke.test.tsx`, `src/components/ui/*` (via CLI)

**Interfaces:**
- Produces: Vitest `projects`: `node` (existing includes plus `test/**`, `src/**/*.test.ts`, excluding `src/ui/**`) and `dom` (`src/ui/**/*.test.{ts,tsx}`, `environment: "happy-dom"`, `setupFiles: ["src/ui/test/setup.ts"]`). Setup registers Testing Library `cleanup` after each test and a `matchMedia` stub (`matches: false`).
- shadcn components available: `tabs`, `sheet`, `input`, `radio-group`, `badge`, `table`, `skeleton`, `separator`.

- [ ] **Step 1:** Add dev dependencies `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom`, `happy-dom` at their latest versions (`bun add -d …`, then `bun run deps:check`). Add the shadcn components with `bunx shadcn@latest add tabs sheet input radio-group badge table skeleton separator`.
- [ ] **Step 2: Write `smoke.test.tsx`:** renders `<Button>確認</Button>` and asserts `getByRole("button", { name: "確認" })`; a second test asserts `window.matchMedia("(min-width: 768px)").matches === false`.
- [ ] **Step 3:** Configure the two projects and setup file; run `bun run test` → all existing tests still pass in `node`, smoke passes in `dom`.
- [ ] **Step 4:** `bun run lint && bun run typecheck && bun run build` clean.
- [ ] **Step 5: Commit** `test: add a DOM test project and the shadcn components the UI needs`.

### Task 3: Theme tokens and no-flash theme

**Files:**
- Modify: `app/globals.css`, `app/layout.tsx`
- Create: `src/ui/theme/theme.ts`, `src/ui/theme/theme.test.ts`

**Interfaces:**
- Produces: `type ThemePref = "system" | "light" | "dark"`; `resolveTheme(pref: ThemePref, systemDark: boolean): "light" | "dark"`; `applyTheme(pref: ThemePref): void` (toggles class `dark` on `document.documentElement` and sets `style.colorScheme`); `THEME_INIT_SCRIPT: string` (self-contained IIFE source that reads `localStorage["muggle.settings.v1"]`, parses JSON, reads `.theme`, resolves against `prefers-color-scheme`, applies the class; swallows every error).
- CSS: tokens `--up`, `--down`, `--warn`, `--warn-foreground` in `:root` and `.dark`, mapped as `--color-up`, `--color-down`, `--color-warn` in `@theme inline` so `text-up`, `text-down`, `bg-warn` work. Light: up `oklch(0.577 0.245 27)`, down `oklch(0.55 0.15 150)`; dark: brighter variants with ≥ 4.5:1 contrast on the dark card.

- [ ] **Step 1: Tests** (`theme.test.ts`): `resolveTheme("system", true) === "dark"`, `("light", true) === "light"`, `("dark", false) === "dark"`. Executing `THEME_INIT_SCRIPT` with `new Function("document","localStorage","matchMedia", …)` against fakes: stored `{"theme":"dark"}` adds class `dark`; stored garbage `{` adds nothing and does not throw; `localStorage` that throws does not throw.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement the module, CSS tokens, and in `app/layout.tsx` add `suppressHydrationWarning` on `<html>` and `<script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />` as the first child of `<head>`; set `viewport.themeColor` to `[{ media: "(prefers-color-scheme: light)", color: "#ffffff" }, { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" }]`.
- [ ] **Step 4:** Run tests, lint, typecheck → PASS. **Step 5: Commit** `feat(ui): red/green and warning tokens, no-flash theme`.

### Task 4: Device storage, settings and last-seen

**Files:**
- Create: `src/ui/device/storage.ts`, `src/ui/device/settings.ts`, `src/ui/device/settings-provider.tsx`, `src/ui/device/last-seen.ts`, with `*.test.ts(x)` beside each.
- Modify: `app/layout.tsx` (wrap children in `SettingsProvider`).

**Interfaces:**
- `storage.ts`: `readItem(key: string): string | null`, `writeItem(key: string, value: string): boolean`, `removeItem(key: string): void` — all swallow exceptions (return `null`/`false`).
- `settings.ts`: `type Settings = { lens: Lens; theme: ThemePref }`; `DEFAULT_SETTINGS: Settings = { lens: "beginner", theme: "system" }`; `SETTINGS_KEY = "muggle.settings.v1"`; `parseSettings(raw: string | null): Settings` (Zod; per-field fallback to the default, so `{"lens":"pro","theme":"x"}` → `{lens:"pro",theme:"system"}`); `serializeSettings(s: Settings): string`.
- `settings-provider.tsx`: `SettingsProvider({ children })`; `useSettings(): { settings: Settings; ready: boolean; setLens(l: Lens): void; setTheme(t: ThemePref): void }`. First render uses defaults with `ready=false`; an effect reads storage, sets `ready=true`, listens to the `storage` event (cross-tab sync), and `setTheme` also calls `applyTheme`. Also reacts to `prefers-color-scheme` changes while theme is `system`.
- `last-seen.ts`: `LAST_SEEN_KEY = "muggle.lastSeen.v1"`; `readLastSeen(): string | null` (valid `YYYY-MM-DD` via `isCalendarDate` from `@/lib/dates`, else `null`); `writeLastSeen(tradeDate: string): void` (never moves backwards: ignores a date earlier than the stored one).

- [ ] **Step 1: Tests.** `parseSettings(null)`, `parseSettings("{")`, `parseSettings('{"lens":"pro"}')` → defaults/partial as above. `readLastSeen` with `"2026-13-45"` → `null`; `writeLastSeen("2026-10-08")` then `writeLastSeen("2026-10-05")` leaves `2026-10-08`. `storage` functions return `null`/`false` when `localStorage` getters throw (stub `window.localStorage`). Provider (dom): initial render `ready=false` then `true`; `setLens("pro")` persists JSON and re-renders consumers; stored garbage yields defaults without throwing; a `storage` event for `SETTINGS_KEY` updates the lens.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat(ui): safe device storage, settings provider, last-seen date`.

### Task 5: API types and the cache-backed resource hook

**Files:**
- Create: `src/ui/data/api.ts`, `src/ui/data/resource-cache.ts`, `src/ui/data/load-resource.ts`, `src/ui/data/use-resource.ts`, with tests beside each.

**Interfaces:**
- `api.ts`: `type Jsonify<T>` (Date → string, recursive); `type TodayResponse = { digest: DigestSnapshot | null; board: SectorBoard | null; stale: boolean }`; `type BriefingJson = Jsonify<BriefingResponse>` (from `@/insight/briefing-service`); `type RecapJson = Jsonify<Recap>`; `type SectorDetailJson = SectorDetail`; `type GlossaryJson = { terms: GlossaryTerm[] }`; URL builders `todayUrl()`, `briefingLatestUrl(lens: Lens)`, `recapUrl(since: string)`, `sectorsUrl()`, `sectorDetailUrl(group: string)` (uses `encodeURIComponent`), `glossaryUrl()`.
- `resource-cache.ts`: `CACHE_VERSION = 1`; `type CacheEntry<T> = { v: number; savedAt: string; dataDate: string | null; body: T }`; `readCache<T>(url: string): CacheEntry<T> | null` (null on missing, wrong version, corrupt JSON); `writeCache<T>(url: string, entry: CacheEntry<T>, now?: Date): void` (skips bodies over 1 MB serialized; keeps at most `MAX_CACHE_ENTRIES = 30` entries, evicting the oldest `savedAt`). Key prefix `muggle.cache.`.
- `load-resource.ts`: `type FetchFailure = "not_found" | "unavailable" | "busy" | "failed"`; `type LoadResult<T> = { ok: true; body: T; dataDate: string | null } | { ok: false; kind: FetchFailure; retryAfterSeconds: number | null }`; `loadResource<T>(url: string, fetchImpl?: typeof fetch): Promise<LoadResult<T>>`. 404 → `not_found`; 503 with body `{error:"busy"}` → `busy`, any other 503 → `unavailable` (both read `retry-after`); other non-2xx, network error, or invalid JSON → `failed`. `dataDate` = header `x-data-trade-date`.
- `use-resource.ts`: `type ResourceState<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; data: T; dataDate: string | null; fromCache: boolean; savedAt: string | null } | { status: "error"; kind: FetchFailure; retryAfterSeconds: number | null }`; `useResource<T>(url: string | null): ResourceState<T> & { reload(): void }`. `url === null` returns `{ status: "idle" }`. With a url: show the cached entry at once (`fromCache: true`), fetch, on success replace with fresh (`fromCache: false`) and write cache; on failure keep cached data (`fromCache: true`) when present, else `error`. Ignores responses for a url that is no longer current.

- [ ] **Step 1: Tests.** `resource-cache`: round trip; wrong `v` → null; 31st write evicts the oldest; oversize body not stored; throwing storage is silent. `loadResource` with injected `fetch`: 200 returns body and the date header; 404; 503 busy with `retry-after: "12"` → `retryAfterSeconds: 12`; 503 `unavailable`; rejected fetch → `failed`; non-JSON → `failed`. `useResource` (dom, fake `fetch` via `vi.stubGlobal`): idle for null url; loading → ready fresh; cached entry renders first with `fromCache: true` then becomes fresh; failing fetch with a cache keeps `ready`/`fromCache: true`; failing fetch without cache → `error`; changing the url ignores a late response from the old one. `sectorDetailUrl("軸承／滑軌")` equals `/api/market/sectors/%E8%BB%B8%E6%89%BF%EF%BC%8F%E6%BB%91%E8%BB%8C`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5: Commit** `feat(ui): typed API urls and a cache-backed resource hook`.

### Task 6: Formatting helpers and the app shell

**Files:**
- Create: `src/ui/format.ts`, `src/ui/format.test.ts`, `src/ui/shell/nav-items.ts`, `src/ui/shell/app-shell.tsx`, `src/ui/shell/app-shell.test.tsx`, `src/ui/shell/use-online.ts`, `app/(app)/layout.tsx`
- Move: `app/page.tsx` → `app/(app)/page.tsx` (placeholder `<TodayScreen />` comes in Task 9; keep a temporary heading until then).

**Interfaces:**
- `format.ts`: `type Trend = "up" | "down" | "flat"`; `trendOf(n: number): Trend`; `trendClass(t: Trend): string` (`text-up`, `text-down`, `text-muted-foreground`); `formatSigned(n: number, digits = 2): string` (`+3.90`, `-2.80`, `0.00`, ASCII hyphen-minus); `formatPct(n: number, digits = 2): string` (`+3.90%`); `formatYi(n: number): string` (`+57.44 億`); `formatInt(n: number): string` (thousands separator `49,349`); `formatDataDate(tradeDate: string): string` → `2026-10-08（四）`; `formatDataLine(meta: { tradeDate: string; session: "closed" | "intraday" | "unknown"; asOf: string | null }): string` → `資料日期 2026-10-08（四）盤後` / `…盤中 13:25` / date only for unknown.
- `nav-items.ts`: `NAV_ITEMS = [{ href: "/", label: "今日", icon: House }, { href: "/sectors", label: "族群", icon: LayoutGrid }, { href: "/glossary", label: "名詞", icon: BookOpen }] as const`; `SETTINGS_ITEM = { href: "/settings", label: "設定", icon: Settings }`; `isActive(pathname: string, href: string): boolean` (`/` exact; others prefix on segment boundary).
- `AppShell({ children })`: below `md` a header (title, gear link to `/settings`) and a fixed bottom bar of the three items with icon above label, `aria-current="page"` on the active one; from `md` a left sidebar (title, three items icon + label, 設定 at the bottom) and a content area with `max-w-6xl` and gutters. Safe-area padding at the bottom of the bar. `use-online.ts`: `useOnline(): boolean` (`navigator.onLine` + online/offline events). When offline the shell shows a banner with the exact text `目前離線，顯示的是上次載入的資料。`.

- [ ] **Step 1: Tests.** `format`: `formatSigned(3.9) === "+3.90"`, `(-2.8) === "-2.80"`, `(0) === "0.00"`, `(-0) === "0.00"`; `formatPct(-1.24) === "-1.24%"`; `formatYi(57.44) === "+57.44 億"`; `formatInt(49349) === "49,349"`; `formatDataDate("2026-10-08") === "2026-10-08（四）"`; `formatDataLine` for closed and for intraday with `asOf "13:25"`. `isActive("/sectors/x","/sectors")` true, `isActive("/sectorsX","/sectors")` false, `isActive("/glossary","/")` false. Shell (dom): both nav variants render the three labels and a settings link; the active item has `aria-current="page"` (mock `usePathname`); `navigator.onLine = false` shows the banner text.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run, lint, typecheck, `bun run build` → PASS. **Step 5: Commit** `feat(ui): app shell with bottom bar, sidebar and formatting helpers`.

### Task 7: Settings screen

**Files:**
- Create: `src/ui/settings/settings-screen.tsx`, `src/ui/settings/settings-screen.test.tsx`, `app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `useSettings` (Task 4), shadcn `radio-group`.
- Produces: `SettingsScreen()`: two radio groups. 閱讀模式: `入門`（用白話解釋，名詞附說明）and `專業`（使用市場用語，顯示更多指標）. 外觀: `跟隨系統`, `淺色`, `深色`. Changing a value applies immediately (no save button) and is remembered on the device. A line states `設定只存在這個裝置上。`

- [ ] **Step 1: Tests (dom):** selecting 專業 sets the stored lens to `pro`; selecting 深色 stores `dark` and adds class `dark` to `<html>`; with stored `{"lens":"pro","theme":"light"}` the matching radios are checked after mount; radios are reachable by role `radio` with those names.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(ui): settings screen for reading mode and theme`.

### Task 8: Glossary page and term chips

**Files:**
- Create: `src/ui/glossary/use-glossary.ts`, `src/ui/glossary/search.ts`, `src/ui/glossary/term-chip.tsx`, `src/ui/glossary/term-panel.tsx`, `src/ui/glossary/glossary-screen.tsx`, `src/ui/glossary/use-media-query.ts`, tests beside, `app/(app)/glossary/page.tsx`

**Interfaces:**
- `useGlossary(): { terms: GlossaryTerm[]; byId: Record<string, GlossaryTerm>; status: "loading" | "ready" | "error" }` over `glossaryUrl()`.
- `searchTerms(terms: GlossaryTerm[], query: string): GlossaryTerm[]`: trims, case-insensitive substring over `term`, `aliases`, `beginner.plain`; empty query returns all in original order; terms whose `term` or alias matches rank before others.
- `CATEGORY_LABELS: Record<GlossaryCategory, string>` = `{ market: "市場", flow: "資金", limit: "漲跌停", planning: "規劃" }`; the page hides a category with no terms.
- `TermChip({ termId, onOpen })`: small pill button showing the term name. `TermPanel({ term, lens, open, onOpenChange, onOpenRelated })`: `Sheet` with `side="bottom"` below `md` and `side="right"` from `md` (`useMediaQuery("(min-width: 768px)")`). Beginner lens shows `plain`, `analogy` (when not null, prefixed `比喻：`) and `whyItMatters`; pro lens shows `definition`, `formula` (when not null) and `source` (`來源：darkfanxing` / `來源：自編`). Related terms are chips that switch the panel's term. `useTermPanel(byId)` hook returning `{ open(termId), panel: ReactNode }` so any screen can host one panel.
- Consumes: `useSettings().settings.lens`.

- [ ] **Step 1: Tests.** `searchTerms`: `"內外盤"` finds the term whose `term` or alias contains it; empty query returns all; whitespace-only returns all; an alias match ranks ahead of a description-only match. Panel (dom): beginner shows `whyItMatters` text and no `definition`; pro shows the definition and hides the beginner text; `analogy: null` renders no `比喻：`; clicking a related chip shows that term. Glossary screen (dom, fake fetch): typing in the search box filters; each listed term opens the panel.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(ui): glossary page, term chips and the term panel`.

### Task 9: Today screen (the 今天 tab)

**Files:**
- Create: `src/ui/today/view-model.ts`, `src/ui/today/view-model.test.ts`, `src/ui/today/today-screen.tsx`, `src/ui/today/today-card.tsx`, `src/ui/today/breadth-bar.tsx`, `src/ui/today/tile-grid.tsx`, `src/ui/today/movers-card.tsx`, `src/ui/today/flow-card.tsx`, `src/ui/today/today-screen.test.tsx`
- Modify: `app/(app)/page.tsx` → renders `<TodayScreen />`

**Interfaces:**
- Constants: `DISCLAIMER = "以上為資料整理與教育說明，不構成投資建議。"`, `AI_NOTE = "標題與說明由 AI 整理，數字來自當天資料"`, `MOVER_ROWS = 5`, `FLOW_ROWS = 3`.
- `breadthBar(market: DigestSnapshot["market"]): { up: number; down: number; upPct: number } | null` (`null` when `up + down === 0`; `upPct` = `up/(up+down)*100` rounded to one decimal).
- `type Tile = { id: string; label: string; value: string; trend: Trend }`; `todayTiles(digest: DigestSnapshot, lens: Lens): Tile[]`. Both lenses: `台指期收盤` (`formatInt`), `漲跌` (`formatSigned(change, 0)` + ` 點`, e.g. `-619 點`), `漲跌幅` (`formatPct`), omitted when `market.futures` is null; `漲／跌族群` value `${upGroups} / ${downGroups}`. Pro adds `力度` (`formatPct(market.force)`) and `面積` (`formatPct(market.breadth)`).
- `type BriefingState = { kind: "current"; headline: string; summary: string; sections: {title: string; body: string}[]; takeaway: string; termIds: string[]; periodKey: string } | { kind: "older"; headline: string; periodKey: string } | { kind: "pending" }`; `briefingState(digestTradeDate: string, briefing: BriefingJson | null): BriefingState` — `current` when `periodKey >= digestTradeDate`; `older` when earlier; `pending` for `null`.
- `moverRows(list: readonly { name: string; changePct: number }[] | null, limit = MOVER_ROWS): { name: string; value: string; trend: Trend }[]`; `flowRows(list: readonly FlowRow[] | null, limit = FLOW_ROWS): { name: string; value: string; trend: Trend }[]` (`formatYi`).
- `TodayScreen()`: waits for `useSettings().ready`; loads `todayUrl()` and `briefingLatestUrl(lens)`; renders `TodayCard` (Task 10 adds the tab switch; this task renders the 今天 content directly): data line (`formatDataLine` of the digest), headline (`current` → `headline`; `older` → `今天的解讀還在整理中` plus `${periodKey} 的解讀：${headline}` in muted text; `pending` → `今天的解讀還在整理中`), `BreadthBar` with labels `上漲族群 87` / `下跌族群 88`, tiles, briefing `summary` and sections (current only), term chips for the briefing's `termIds` (via `useTermPanel`), `MoversCard` (領漲／領跌, from `digest.topGainers` and `topLosers`), `FlowCard` (資金流向: top inflow `netBuy`, top outflow `netSell`), `AI_NOTE` under the card, and `DISCLAIMER` last. Empty state when `digest` is null and nothing is cached: `還沒有收盤資料。排程跑過之後這裡會出現今天的市場。` Loading uses `Skeleton`. Cached-while-failing shows `StaleNotice`: `無法更新，顯示的是 ${formatDataDate(dataDate)} 的資料。`

- [ ] **Step 1: Tests (pure).** Using the 2026-10-08 fixture (`parseDigest` of `test/fixtures/darkfanxing/digest-2026-10-08.html`): `breadthBar` → `{up: 87, down: 88, upPct: 49.7}`; zero groups → `null`. `todayTiles(digest, "beginner")` labels are exactly the four above in order, values `49,349`, `-619 點`, `-1.24%`, `87 / 88`, pro adds `力度 -0.63%` and `面積 +0.20%`; with `futures = null` the futures tiles disappear and nothing contains `NaN`. `briefingState("2026-10-08", briefing{periodKey:"2026-10-08"})` → `current`; `"2026-10-07"` → `older`; `null` → `pending`. `moverRows(null) → []`; limit applied; trend/sign formatting.
- [ ] **Step 2: Tests (dom, fake fetch):** all-data case shows headline, `上漲族群 87`, `下跌族群 88`, the AI note and the exact disclaimer as the last text; older briefing shows `今天的解讀還在整理中` and `2026-10-07 的解讀` and does NOT show the older headline as the card heading; pending (briefing 404) shows the pending text and still shows the tiles; cached data + failing fetch shows the stale notice with the cached date; lens `pro` renders `力度`; empty store shows the empty-state text.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run tests, lint, typecheck, build → PASS. **Step 6: Commit** `feat(ui): today screen`.

### Task 10: The "離開期間" tab and last-seen recording

**Files:**
- Create: `src/ui/today/away.ts`, `src/ui/today/away.test.ts`, `src/ui/today/away-panel.tsx`, `src/ui/today/use-record-visit.ts`, `src/ui/today/use-record-visit.test.tsx`
- Modify: `src/ui/today/today-card.tsx`, `src/ui/today/today-screen.tsx`, `src/ui/today/today-screen.test.tsx`

**Interfaces:**
- `AWAY_TAB_MIN_MISSED_DAYS = 2`.
- `type AwayRow = { tradeDate: string; futuresChangePct: number | null; summary: string | null; weekHeadline: string | null }`; `type AwayView = { from: string; to: string; missedDays: number; truncated: boolean; cumulativePct: number | null; strongFrom: number | null; strongTo: number | null; rows: AwayRow[] }`.
- `awayView(recap: RecapJson | null, lens: Lens): AwayView | null` — `null` when recap is null, `kind !== "recap"`, or `missedTradingDays < AWAY_TAB_MIN_MISSED_DAYS`. `rows` in date order; `summary = day.summary[lens]`; `weekHeadline` = the headline of `weeks.find(w => w.weekKey === day.coveredByWeek)?.briefings[lens]` or `null`. `strongFrom/strongTo` = `quadrantShift?.from.強勢` / `.to.強勢` (null when `quadrantShift` is null).
- `useRecordVisit(latestTradeDate: string | null): void` — writes `writeLastSeen(latestTradeDate)` on `pagehide`, on `visibilitychange` to hidden, and on unmount; never during the visit and never when the date is null (so the away tab does not vanish mid-visit).
- `TodayScreen`: `since = readLastSeen()` after mount; recap is fetched only when `since !== null` (`recapUrl(since)`); `TodayCard` shows two tabs only when `awayView` is non-null: `今天` and `離開期間（${missedDays} 日）`; the away tab is the default and `今天` carries a small dot (`aria-label="有今天的新內容"`). Away panel content: date range line, tiles `台指期累計 ${formatPct}` (omitted when null), `有開盤 ${missedDays} 天`, `強勢族群數 ${strongFrom} → ${strongTo}` (omitted when null), then one row per day: `MM/DD` + summary (or only the day's futures change when the summary is null) + `week headline` as a second line when present; the note `每天的標題是 AI 整理的，數字來自當天資料`; when `truncated`: `只顯示最近 90 天`. A recap error (`unavailable`/`failed`/400) shows no away tab and no error toast.

- [ ] **Step 1: Tests (pure):** `awayView` returns `null` for `up-to-date`, for `missedTradingDays: 1`, for null; for a 3-day recap with weeks covering day 1 maps `weekHeadline`, picks the right lens, keeps `summary: null` rows, copies `truncated`, `cumulativePct: null` when the server sent null.
- [ ] **Step 2: Tests (dom):** `useRecordVisit` writes nothing on mount, writes the date on `pagehide`, on `visibilitychange` hidden, and on unmount; never writes for `null`; never moves backwards. `TodayScreen` with stored last-seen `2026-10-02` and a 3-day recap shows both tabs, the away tab selected, the dot, and the day rows; with a recap 503 it shows the 今天 content and no tabs; with no last-seen no recap request is made (assert `fetch` was not called with `/api/market/recap`).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** PASS, lint, typecheck. **Step 6: Commit** `feat(ui): away-period tab and last-seen recording`.

### Task 11: Sector view models and copy

**Files:**
- Create: `src/ui/sectors/view-model.ts`, `src/ui/sectors/view-model.test.ts`, `src/ui/sectors/copy.ts`, `src/ui/sectors/copy.test.ts`

**Interfaces:**
- `type SectorView = "change" | "flow" | "quadrant"`.
- `copy.ts` (DRAFT wording, flagged for the user's review in a header comment): `VIEW_LABELS: Record<Lens, Record<SectorView, string>>` — beginner `今天誰漲誰跌` / `錢跑去哪裡` / `誰在變強變弱`, pro `漲跌幅` / `內外盤金額差` / `四象限`; `SECTOR_HELP_TITLE = "什麼是族群？"`; `SECTOR_HELP_BODY = "把做同一類生意的公司放在一起看，例如「被動元件」就是做電子零件的那一群。看族群比看單一股票更容易知道錢流向哪裡。"`; `FLOW_NOTE = "只列出前十名流入與前十名流出"`; `QUADRANT_TRANSITIONS_TITLE = "今天換象限"`; `plainChangeLine(row: SectorRow): string`: `` `${changePct>0?"今天上漲":changePct<0?"今天下跌":"今天持平"}，${constituents} 家公司裡有 ${advancers} 家上漲、${decliners} 家下跌${limitUp>0?`，${limitUp} 家漲停`:""}${limitDown>0?`，${limitDown} 家跌停`:""}。` ``; `plainFlowLine(netFlow: number): string`: positive → `今天買進的金額比賣出多約 ${abs.toFixed(2)} 億元。`, negative → `今天賣出的金額比買進多約 ${abs.toFixed(2)} 億元。`, zero → `今天買進與賣出的金額差不多。` (before shipping, the implementer checks these against the glossary entries for 內外盤 and aligns the wording so the two never contradict).
- `view-model.ts`: `type SortKey = "name" | "changePct" | "advancers" | "turnover" | "change1mPct"`; `type SortDir = "asc" | "desc"`; `filterSectors(rows: SectorRow[], query: string): SectorRow[]` (trim, case-insensitive substring on `name`; empty → all); `sortSectors(rows: SectorRow[], key: SortKey, dir: SortDir): SectorRow[]` (stable, nulls last for `change1mPct`, `name` via `localeCompare("zh-Hant")`); `quadrantSummary(q: NonNullable<DigestSnapshot["quadrant"]>): { counts: {label: Quadrant; today: number; prev: number | null}[]; transitions: {name: string; from: Quadrant; to: Quadrant}[]; leaders: {label: string; names: string[]}[] }` with counts in the fixed order 強勢, 轉強, 轉弱, 弱勢.

- [ ] **Step 1: Tests.** `plainChangeLine` for an up row with limit-ups, a down row, and a flat row (exact strings); `plainFlowLine(57.44)`, `(-104.13)`, `(0)`. `filterSectors` matches `"被動"`, `"mcu"` against `MCU`, empty string returns all, no match returns `[]`. `sortSectors` by `changePct` desc/asc, stable on ties, `change1mPct` nulls last in both directions, `name` asc. `quadrantSummary` from the fixture digest: four counts in the fixed order, `prev` null when `counts.prev` is null, transitions include `車用電子` 強勢 → 轉弱.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(ui): sector view models and draft beginner wording`.

### Task 12: Sectors screen (list and the three views)

**Files:**
- Create: `src/ui/sectors/sectors-screen.tsx`, `src/ui/sectors/change-list.tsx`, `src/ui/sectors/change-table.tsx`, `src/ui/sectors/flow-view.tsx`, `src/ui/sectors/quadrant-view.tsx`, `src/ui/sectors/sectors-screen.test.tsx`, `app/(app)/sectors/page.tsx`

**Interfaces:**
- Consumes: `useResource(sectorsUrl())` (board), `useResource(todayUrl())` (digest for flow and quadrant), Task 11 functions, `useSettings`, glossary term chips (Task 8).
- `SectorsScreen()`: header line `formatDataLine(board)` (board's own session and time; intraday boards say `盤中`). Beginner lens: `SECTOR_HELP_TITLE` / `SECTOR_HELP_BODY` box, view toggle with the beginner labels. Search box (`搜尋族群`). View state is local (`useState<SectorView>("change")`).
  - `change`: below `md`, `ChangeList` (one row per sector: name, `formatPct(changePct)` coloured, beginner `plainChangeLine` or pro `漲 ${advancers}／跌 ${decliners}` and 近一月 `formatPct(change1mPct)`; sorted by `changePct` desc with a toggle button `由高到低`/`由低到高`); from `md`, `ChangeTable` with the pro columns (名稱, 漲跌幅, 上漲／下跌家數, 成交值, 近一月) sortable by clicking headers (`aria-sort`); beginner table drops 成交值 and shows the plain line column instead.
  - `flow`: two lists (`買的人比賣的人多（錢流進來）` / `賣的人比買的人多（錢流出去）` in beginner; `淨流入前十` / `淨流出前十` in pro) from `digest.netBuy`/`netSell` (≤ 10 each) with `FLOW_NOTE`; beginner rows show `plainFlowLine`, pro rows show `formatYi(netFlow)` and `changePct`; `null` lists render `這一天沒有資金流向資料。`
  - `quadrant`: four count cards (today vs prev when present) with a glossary chip per quadrant name, then `QUADRANT_TRANSITIONS_TITLE` list and the leaders; `digest.quadrant === null` renders `這一天沒有四象限資料。`
  - Rows are links/buttons that set `?group=<encoded name>` (Task 13 handles the detail); search applies to `change` only (flow and quadrant ignore it and the box is hidden there).
- Empty and error states: no board and nothing cached → `還沒有族群資料。`; fetch failure with cache → `StaleNotice` with the cached date (reuse the Task 9 component, moved to `src/ui/shell/stale-notice.tsx` if needed).

- [ ] **Step 1: Tests (dom, fake fetch with the fixture-derived board and digest):** default view lists sectors sorted by `changePct` desc and the first row is the top gainer; typing `被動` leaves only matching rows; the sort toggle reverses order; switching to the flow view shows exactly the digest's netBuy/netSell names and the note; `digest.quadrant = null` shows the no-data text; beginner lens shows the help box and `今天誰漲誰跌`, pro lens shows `漲跌幅` and no help box; stale cached data shows the stale notice; `matchMedia("(min-width: 768px)")` true renders a table with `aria-sort` headers (stub the media query in the test).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS, lint, typecheck, build. **Step 5: Commit** `feat(ui): sectors screen with change, flow and quadrant views`.

### Task 13: Sector detail (constituents)

**Files:**
- Create: `src/ui/sectors/sector-detail.tsx`, `src/ui/sectors/sector-detail.test.tsx`
- Modify: `src/ui/sectors/sectors-screen.tsx`

**Interfaces:**
- `SectorDetail({ group, onClose })`: loads `sectorDetailUrl(group)` (shown from the shared hook; `useSearchParams().get("group")` is the source of truth in `SectorsScreen`). Shows `group`, `formatDataLine` of `{tradeDate, asOf, session: "unknown"}`, rank `第 ${rank} / ${rankOf}`, `formatPct(changePct)`, 近一月, and the stocks (name, code, `formatPct(changePct)`, `noTrade` → `今天沒成交`). Below `md` the detail replaces the list with a `返回` button (`onClose` removes `?group`); from `md` it renders in a right pane next to the list and the selected row is highlighted. States: loading `Skeleton`; `not_found` → `找不到這個族群。`; `busy` → `暫時查不到，約 ${retryAfterSeconds ?? 60} 秒後再試。` with a `重試` button (calls `reload`); `failed` → `暫時讀不到成分股。` with `重試`. Stocks list renders however many rows arrive (no fixed limit).

- [ ] **Step 1: Tests (dom):** loaded detail shows the name, rank text and each stock; a `noTrade` stock shows `今天沒成交`; 404 → not-found text; 503 busy with `retry-after: 12` → text contains `12 秒` and the retry button refetches; `group=軸承／滑軌` (encoded) loads the correctly encoded URL; the back button calls `onClose`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and wire into `SectorsScreen` (mobile replace, desktop pane). **Step 4:** PASS, lint, typecheck. **Step 5: Commit** `feat(ui): sector detail with retry on busy`.

### Task 14: PWA offline behaviour

**Files:**
- Modify: `src/sw.ts`, `public/manifest.webmanifest`, `src/components/service-worker-registration.tsx` (only if needed)
- Create: `src/sw-routes.ts`, `src/sw-routes.test.ts`

**Interfaces:**
- `src/sw-routes.ts`: `isNavigationFallbackCandidate(request: { mode: string; destination: string }, url: URL): boolean` (same-origin document navigation, path not under `/api/`); `APP_SHELL_URL = "/"`.
- `src/sw.ts`: keep the Serwist precache; add runtime caching so `/api/*` GETs are NOT cached by the service worker (the app owns data caching and the offline banner), and document navigations use NetworkFirst with a 3 s network timeout and cache name `pages`, falling back to the cached `/` document when a navigation cannot be served. Manifest: `theme_color`/`background_color` `#ffffff`, `description` `台股盤後市場解讀與族群資金流向`, `categories: ["finance"]`.

- [ ] **Step 1: Tests:** `isNavigationFallbackCandidate` true for `{mode:"navigate", destination:"document"}` on `/sectors`; false for `/api/market/today`; false for a cross-origin URL; false for a non-navigate request.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `bun run test && bun run build` → PASS and the build still emits a non-empty precache manifest (the existing build check). **Step 5:** Manual check, record the result in the commit body: serve the production build, load `/` and `/sectors` online, then emulate offline in Chrome DevTools and reload each page; the shell renders and shows the offline banner with cached data. **Step 6: Commit** `feat(pwa): serve cached pages offline, leave API caching to the app`.

### Task 15: Dev sample data, visual pass, docs

**Files:**
- Create: `scripts/seed-sample-briefings.ts`
- Modify: `README.md`, `package.json` (script `briefing:sample`)

**Interfaces:**
- `scripts/seed-sample-briefings.ts`: refuses to run when `NODE_ENV === "production"` (exit 1 with a one-line message); writes one clearly labelled sample daily briefing per lens (`model: "sample"`, text begins `【範例】`) for the latest stored digest date through the existing briefing repository (`saveBriefing`/upsert in `src/db/repositories/briefings.ts`), content valid under `briefingContentSchema`. Prints only dates and counts.
- README: a UI section (screens, lens/theme in Settings, offline behaviour, `bun run briefing:sample` for local look-and-feel without an LLM).

- [ ] **Step 1: Test** `scripts/seed-sample-briefings` logic via a pure `buildSampleBriefing(lens: Lens, tradeDate: string): BriefingContent` exported from a module under `src/insight/sample-briefing.ts` with a test that it passes `briefingContentSchema`, starts with `【範例】`, and has distinct text per lens.
- [ ] **Step 2:** Implement script and README. **Step 3:** With the local Postgres and the 2026-10-08 data, run `bun run briefing:sample`, `bun run dev`, and capture headless-Chrome screenshots of `/`, `/sectors`, `/glossary`, `/settings` at 390×844 and 1280×800 in light and dark (a shell loop with `google-chrome --headless=new --screenshot`); look for clipped text, horizontal scroll, unreadable contrast, and fix what shows. Record what was checked in the commit body.
- [ ] **Step 4:** Full gate: `bun run lint && bun run typecheck && bun run test && bun run build && bun run deps:check`. **Step 5: Commit** `docs(ui): README for the screens and a dev-only sample briefing seed`.

---

## Self-review notes

- Spec coverage: layout C with both tabs (9, 10); LLM headline per lens, factual bar, no fixed labels (9); away tab from stored summaries, week headline, truncated, 503 (10); lens/theme in Settings (4, 7); nav bottom bar/sidebar/gear and three destinations (6); sectors three views limited to existing data, plain wording in one draft file, desktop table + pane (11–13); glossary chips and panel (8); disclaimer (9); date labels and offline banner (6, 9, 14); futures guard on the cumulative figure (1); desktop layout in 6, 9, 12, 13.
- Types: `Lens`, `ThemePref`, `Settings`, `ResourceState`, `Trend`, `SectorView`, `AwayView` are defined once and reused by name in later tasks.
- Later tasks treat the `idle` state of `ResourceState` as "nothing to show yet".
