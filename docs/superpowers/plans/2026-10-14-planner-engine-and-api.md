# Phase 3A Planner Engine and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic backend of the capital planner: instrument discovery and eligibility from real data, total-return price series, the signed-off questionnaire / allocation / rhythm rules, the backtest engine, and a stateless `POST /api/plan`.

**Architecture:** Pure, injectable modules under `src/planner/**` (rules, amounts, total-return, backtest) with no database or network access; thin repositories and a service (`planPortfolio`) wire them to Postgres; ingestion keeps the category members' prices current; one route validates a Zod request and returns a Zod-typed response. Nothing in this plan calls an LLM (batch explanations are a later plan, 3A-2).

**Tech Stack:** TypeScript, Bun, Vitest (+ PGlite for repositories), Drizzle ORM + drizzle-kit migrations, Zod, vinext route handlers, FinMind (free API).

**Spec:** `docs/superpowers/specs/2026-10-14-muggle-investor-planner-design.md` (binding; the "使用者已簽核的規則" are fixed values to copy exactly, the "補充決定" section is the builder's contract). Product context: `docs/superpowers/specs/2026-10-11-muggle-investor-design.md`.

## Global Constraints

- Stack: TypeScript strict, Bun, Biome, Zod, Drizzle; all dependencies latest (`bun run deps:check` clean). Add no dependencies unless a task says so.
- Every number a plan response contains comes from data or these deterministic modules. No LLM call anywhere in this plan.
- Money is whole New Taiwan dollars (`number`, integers; slices rounded so they sum exactly to their total). Dates are `YYYY-MM-DD` strings; month arithmetic uses UTC and never the machine's time zone.
- Questionnaire values, the allocation table, rhythm rules and eligibility thresholds are copied exactly from the spec's 「使用者已簽核的規則」 into rule files that are plain data with table-driven tests; they must be easy to change in one place.
- `POST /api/plan` stores nothing and logs no request body or answers; responses are `cache-control: no-store`.
- The backtest uses only dates where every series involved has a bar; the response always states the window (`from`, `to`) and which symbols were used. Total return reinvests distributions; fees and taxes are not modelled and the response says so.
- FinMind calls go through the existing rate limiter (`createFinMindClient`); secrets (`FINMIND_TOKEN`) never appear in logs, errors or fixtures.
- Tests: pure modules in the Vitest `node` project; repository tests on PGlite (see `test/helpers/test-db.ts`); route tests in `test/api/`. Biome clean, `tsc --noEmit` clean, pristine test output.

## Review Focus

- Zero, negative, non-integer or absurd amounts (lump sum and monthly both 0; 10^12 TWD) are rejected with `400 invalid_request`, never `NaN` results. (Task 9)
- An instrument with a gap (a trading day missing from one series) or a corporate action on a date with no bar: the engine aligns on common dates and applies an action at the first bar on or after its ex-date; no `NaN`, no negative prices. (Tasks 5, 6)
- The shared history is shorter than 12 months, or empty: the response says `insufficient_history` instead of misleading metrics; `worstYear` is `null` when the window is shorter than 12 months. (Tasks 6, 9)
- No eligible bond primary (liquidity or history rule) → the bond slice becomes cash with a warning; no eligible core primary → `503 data_unavailable`. (Tasks 8, 9)
- A price/dividend ingestion run is interrupted halfway (first-time backfill of ~20 symbols): the next run continues; a symbol with partial history is never selected as primary with a misleading history length. (Tasks 2, 8)
- Reserve gap ≥ the money the user entered: the response contains only the reserve plan (no allocation or backtest) and says why. (Task 4)

---

## File Structure

- `src/sources/finmind/{schemas,client,index}.ts` (modify): turnover, `fetchStockInfo`, dividend mark.
- `src/db/schema.ts`, `drizzle/0004_*.sql` (modify/create): `price_bars.turnover`, `etf_universe`.
- `src/db/repositories/{prices,etf-universe}.ts`: stats and universe access.
- `src/planner/rules/{questionnaire,allocation,rhythm,instruments}.ts` — signed-off data and pure functions.
- `src/planner/{amounts,total-return,backtest,metrics,selection}.ts` — pure engine pieces.
- `src/planner/plan-service.ts`, `src/planner/schema.ts` — service and Zod contract.
- `app/api/plan/route.ts` — the route.
- Ingestion: `src/ingestion/{tracked-symbols,run-ingestion}.ts` (modify).
- `scripts/plan-dev.ts` (create), `README.md` (modify).

---

### Task 1: FinMind client: instrument list, turnover, bond dividend mark

**Files:**
- Modify: `src/sources/finmind/schemas.ts`, `src/sources/finmind/client.ts`, `src/sources/finmind/index.ts`, `src/sources/finmind/client.test.ts`
- Create: `test/fixtures/finmind/stockinfo-sample.json`, `test/fixtures/finmind/dividend-result-00679B.json`

**Interfaces:**
- Produces: `type StockInfo = { symbol: string; name: string; industry: string; market: string }`; `FinMindClient.fetchStockInfo(): Promise<StockInfo[]>` (dataset `TaiwanStockInfo`, no `data_id`; one entry per symbol, keeping the row with the latest `date` — the dataset repeats symbols; `industry` = `industry_category`, `market` = `type`); `PriceBar` gains `turnover: number | null` from the row's `Trading_money` (optional in the schema, `null` when absent).
- Dividend mark: `cashDividend` is set when `stock_or_cache_dividend` is `"息"` or `"除息"` (FinMind marks bond ETF dividends `除息`; today they are silently dropped).

- [ ] **Step 1: Write failing tests** in `client.test.ts` (injected `fetchImpl`, same style as the existing tests): `fetchStockInfo` parses the sample fixture (a trimmed copy of the real `TaiwanStockInfo` response including two rows for `00679B` with different `date`/`industry_category`) and returns one entry for `00679B` with the later row's industry; `fetchPrices` maps `Trading_money` to `turnover` and gives `null` when the field is missing; `fetchCorporateActions` for `dividend-result-00679B.json` (real rows, mark `除息`) yields `cashDividend: 0.46` for the 2017-08-23 row, and the existing `息`-marked 0050 fixture still passes; a row marked `權` still gives `cashDividend: null`.
- [ ] **Step 2: Run** `bunx vitest run src/sources/finmind` → FAIL.
- [ ] **Step 3: Implement** the schema fields and client method (reuse `fetchDataset`; the `TaiwanStockInfo` call passes no `data_id`). Create the fixtures from real responses: `curl "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo"` and `…TaiwanStockDividendResult&data_id=00679B&start_date=2017-01-01` (public, no token), trimmed to a handful of rows.
- [ ] **Step 4: Run** the same command → PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(finmind): instrument list, turnover and bond dividend mark`.

### Task 2: Schema, repositories and history backfill

**Files:**
- Modify: `src/db/schema.ts`, `src/db/repositories/prices.ts`, `src/db/repositories/prices.test.ts`
- Create: `src/db/repositories/etf-universe.ts`, `src/db/repositories/etf-universe.test.ts`, `drizzle/0004_*.sql` (generated by `bun run db:generate`)

**Interfaces:**
- Schema: `price_bars.turnover double precision NULL`; new table `etf_universe(symbol text primary key, name text not null, market text not null, industry text not null, updated_at timestamptz not null default now(), history_checked_at timestamptz null)`.
- `upsertPriceBars` also writes `turnover` (conflict update includes it).
- `getPriceStats(db: Db, symbol: string, recent = 120): Promise<PriceStats | null>` where `PriceStats = { firstDate: string; lastDate: string; barCount: number; recentTurnovers: number[] }`; each recent turnover is the stored `turnover`, or `close * volume` when it is null; `null` when the symbol has no bars.
- `earliestPriceDate(db: Db, symbol: string): Promise<string | null>`.
- `upsertEtfUniverse(db: Db, items: StockInfo[]): Promise<void>` (only rows whose `industry` contains `ETF`; an update never clears `history_checked_at`), `listEtfUniverse(db: Db): Promise<EtfUniverseRow[]>` (`{ symbol, name, market, industry, updatedAt: Date, historyCheckedAt: Date | null }`), `markHistoryChecked(db: Db, symbol: string, at: Date): Promise<void>`.

- [ ] **Step 1: Write failing tests** on PGlite: turnover round-trips and a re-upsert updates it; `getPriceStats` over bars inserted with a mix of null and non-null turnover returns the right `recentTurnovers` order (ascending date, last 120 only), `barCount`, first/last date; `null` for unknown symbol; `earliestPriceDate`; `upsertEtfUniverse` keeps only ETF-industry rows, updates a renamed symbol and keeps a previously set `history_checked_at`; `markHistoryChecked` sets it.
- [ ] **Step 2: Run** `bunx vitest run src/db/repositories` → FAIL.
- [ ] **Step 3: Implement**; run `bun run db:generate` and commit the generated migration (the test DB helper applies migrations — confirm `test/helpers/test-db.ts` picks it up).
- [ ] **Step 4: Run** → PASS; `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(db): price turnover, ETF universe table and price stats`.

### Task 3: Signed-off rules as data

**Files:**
- Create: `src/planner/rules/questionnaire.ts`, `allocation.ts`, `rhythm.ts`, `instruments.ts`, with `*.test.ts` beside each.

**Interfaces (values copied exactly from the spec's 使用者已簽核的規則):**
- `questionnaire.ts`: `type RiskLevel = 1 | 2 | 3 | 4 | 5`; `QUESTIONS` — five entries `{ id: "age" | "horizon" | "income" | "reserve" | "loss"; options: { id: string; label: string; score: number }[] }` with the spec's labels and scores (option ids are stable ASCII slugs such as `age-60-plus`); `type Answers = Record<(typeof QUESTIONS)[number]["id"], string>` (option ids); `scoreProfile(answers: Answers): Profile` where `Profile = { capacity: 1|2|3|4|5; willingness: 1|2|3|4|5; level: RiskLevel; cappedByHorizon: boolean; reserveFirst: boolean }` — capacity = rounded mean of the first four scores (round half up), level = `min(capacity, willingness)` then capped (`horizon` score 1 → max 1, score 2 → max 2), `reserveFirst` when the reserve answer scores 1. Throws on an unknown option id.
- `allocation.ts`: `type Slice = "core" | "bond" | "dividend" | "satellite" | "cash"`; `ALLOCATION_TABLE: Record<RiskLevel, Record<Slice, number>>` (percent integers, each row sums to 100); `reserveMonthsFor(incomeOptionId: string): 3 | 6 | 9`.
- `rhythm.ts`: `trancheMonthsFor(level: RiskLevel, lump: number, monthly: number): number` → 6 for levels 1–3, 3 for 4–5, and `1` (no staging) when `lump < 3 * monthly`.
- `instruments.ts`: `CATEGORY_MEMBERS: Record<"core" | "bond" | "dividend", readonly string[]>` with the initial members from the spec's 補充決定; `ELIGIBILITY` = `{ maxStaleDays: 10, minHistoryYears: { core: 5, dividend: 5, bond: 3 }, minMedianTurnover: 100_000_000, recentDays: 120, excludedNamePattern: /正2|反1|槓桿|反向|期貨|美元|人民幣|黃金|原油|ETN|VIX|比特|虛擬/ }`.

- [ ] **Step 1: Write failing tests:** all five scores for each question exist and match the spec; `scoreProfile` table-driven cases — all-5s → level 5; capacity 5 but loss answer 1 → level 1; capacity 2 with willingness 5 → level 2; horizon `<1 year` with all-5 otherwise → level 1 and `cappedByHorizon`; horizon `1–3 years` with all-5 otherwise → level 2; reserve `<3 months` → `reserveFirst`; mean rounding at x.5 (capacity from scores 5,5,1,1 = 3; from 5,4,1,1 = 2.75 → 3; from 4,4,1,1 = 2.5 → 3); unknown option id throws. Allocation: every level sums to 100, spot-check `3 → {core 45, bond 25, dividend 20, satellite 5, cash 5}`; `reserveMonthsFor` 3/6/9. `trancheMonthsFor`: level 2 with lump 600000 and monthly 20000 → 6; level 4 → 3; lump 50000 with monthly 20000 → 1. `CATEGORY_MEMBERS` lists no duplicates across categories.
- [ ] **Step 2: Run** `bunx vitest run src/planner/rules` → FAIL.
- [ ] **Step 3: Implement** the four files as plain data plus the small pure functions above. No imports from the database or network layers.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(planner): signed-off questionnaire, allocation, rhythm and instrument rules`.

### Task 4: Amounts, reserve and investing schedule

**Files:**
- Create: `src/planner/amounts.ts`, `src/planner/amounts.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Profile`, `ALLOCATION_TABLE`, `reserveMonthsFor`, `trancheMonthsFor`).
- Produces: `type AmountInput = { lump: number; monthly: number; monthlyExpenses: number; existingReserve: number; incomeOptionId: string; level: RiskLevel }`; `type AmountPlan = { reserveTarget: number; reserveGap: number; reserveOnly: boolean; investable: number; slices: Record<Slice, number>; trancheMonths: number; monthsToFillReserve: number }`; `planAmounts(input: AmountInput): AmountPlan`; `splitByLargestRemainder(total: number, weights: Record<Slice, number>): Record<Slice, number>` (integer amounts that sum exactly to `total`; ties broken in `Slice` order core, bond, dividend, satellite, cash).
- Rules: `reserveTarget = monthlyExpenses × reserveMonthsFor(income)`; `reserveGap = max(0, reserveTarget − existingReserve)`; the lump sum fills the gap first; `investable = lump − min(lump, reserveGap)`; `reserveOnly` when the gap is ≥ the lump sum *and* `lump > 0` or when `lump == 0` and a gap remains (nothing is allocated, `slices` all 0); when the lump cannot cover the gap the remaining gap is filled by monthly contributions: `monthsToFillReserve = ceil(remainingGap / monthly)` (0 when no remaining gap; `Infinity`-free: if `monthly == 0` and a gap remains, `monthsToFillReserve = null` — type `number | null`).

- [ ] **Step 1: Write failing tests:** `splitByLargestRemainder(100000, level-3 weights)` → `{core 45000, bond 25000, dividend 20000, satellite 5000, cash 5000}`; `splitByLargestRemainder(100001, …)` sums to 100001 with the extra unit going to the largest remainder (spell the expected object out); `splitByLargestRemainder(7, level-3)` sums to 7. `planAmounts`: expenses 30000, stable income (3 months) → target 90000; existing 50000, lump 500000 → gap 40000, investable 460000, slices from level 3 sum to 460000, `reserveOnly` false; existing 0, lump 60000 → gap 90000 ≥ lump → `reserveOnly` true, all slices 0, `monthsToFillReserve = ceil(30000 / monthly)` with monthly 10000 → 3; same with monthly 0 → `null`; income unstable (9 months) target 270000; `trancheMonths` follows `trancheMonthsFor`.
- [ ] **Step 2: Run** `bunx vitest run src/planner/amounts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(planner): reserve gap, slice amounts and tranche count`.

### Task 5: Total-return series

**Files:**
- Create: `src/planner/total-return.ts`, `src/planner/total-return.test.ts`

**Interfaces:**
- Consumes: `PriceBar`, `CorporateAction` from `@/sources/finmind`.
- Produces: `type TrPoint = { date: string; index: number }` (index starts at 1 on the first bar); `buildTotalReturnIndex(bars: readonly PriceBar[], actions: readonly CorporateAction[]): TrPoint[]` — bars sorted ascending by the function.
- Method (derived and fixed here): for each bar after the first, `factor = close_t / close_{t-1}` normally; on the first bar on or after an action's ex-date (apply each action once; several actions on the same bar multiply their ratios) `factor = close_t × (Π before_i / after_i) / close_{t-1}`. This is "reinvest distributions at the ex-date reference price"; it needs no cash-dividend amount, so it also works for stock dividends and splits. `index_t = index_{t-1} × factor`. Actions dated before the first bar are ignored; an action with `afterPrice <= 0` or `beforePrice <= 0` is skipped.

- [ ] **Step 1: Write failing tests:** no actions → index equals `close_t / close_0`; a cash dividend (`beforePrice 100`, `afterPrice 99`, close on the ex-date 99, previous close 100) → factor exactly `99 × (100/99) / 100 = 1.0` (the day's drop is exactly the dividend), and a close of 100.98 on that day gives `1.0098 × 100/99`; the real 0050 split row (`2025-06-18`, before 188.65, after 47.16) with previous close 188.65 and ex-date close 47.5 → index ratio `47.5 × (188.65 / 47.16) / 188.65 = 47.5 / 47.16`; an action on a non-trading date (no bar) applies at the next bar; two actions on one bar multiply; an action before the first bar is ignored; bad prices are skipped; unsorted input gives the same result; empty bars → `[]`; a hand-checked three-year series with two dividends matches a spreadsheet-style recomputation written in the test.
- [ ] **Step 2: Run** `bunx vitest run src/planner/total-return` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(planner): total-return index with distributions reinvested`.

### Task 6: Backtest simulation and metrics

**Files:**
- Create: `src/planner/backtest.ts`, `src/planner/metrics.ts`, with `*.test.ts` beside each.

**Interfaces:**
- Consumes: `TrPoint`, `Slice`.
- Produces (metrics.ts): `type CashFlow = { date: string; amount: number }` (negative = money put in, positive = value at the end); `xirr(flows: readonly CashFlow[]): number | null` (annualised, actual/365; `null` when it does not converge in 100 iterations or all flows have one sign); `cagr(startValue: number, endValue: number, days: number): number | null` (`null` for non-positive input or `days < 1`); `maxDrawdown(values: readonly number[]): number` (a non-positive fraction, e.g. −0.35); `annualVolatility(values: readonly number[]): number` (standard deviation of daily simple returns × √252, `0` for fewer than 2 values); `worstRollingYear(points: readonly { date: string; value: number }[]): number | null` (the minimum return over any window of calendar length ≥ 365 days from a point to the first point on or after +1 year; `null` if the series is shorter than one year).
- Produces (backtest.ts): `type Strategy = { weights: Record<Slice, number>; lump: number; trancheMonths: number; monthly: number; rebalanceYearly: boolean }`; `type BacktestSeries = Partial<Record<"core" | "bond" | "dividend", readonly TrPoint[]>>`; `type BacktestResult = { from: string; to: string; invested: number; finalValue: number; xirr: number | null; cagr: number | null; maxDrawdown: number; volatility: number; worstYear: number | null; valueSeries: { date: string; value: number; invested: number }[] }`; `alignOnCommonDates(series: readonly (readonly TrPoint[])[]): { dates: string[]; indices: number[][] }`; `runBacktest(series: BacktestSeries, strategy: Strategy): BacktestResult | null` (`null` when the common window has fewer than 2 dates).
- Mechanics (fixed here): weights are percents (sum 100); `satellite` uses the `core` series, `cash` has a constant index 1 (spec: satellite proxied by core; cash earns 0). Dates are the common dates of the series actually used by slices with weight > 0. Contributions happen on the first common trading day on or after each calendar month start of the window: month 1 gets `lump / trancheMonths + monthly` for the first `trancheMonths` months (the lump is split evenly over those months, rounding the remainder into the first tranche), then `monthly` only; `trancheMonths = 1` means the whole lump on day 1. Every contribution is split by `weights` into the slices' units at that day's index. When `rebalanceYearly`, on the first common trading day on or after each anniversary of the window start the holdings are reset to the target weights (no cost). The portfolio's unit-value series is the portfolio value divided by cumulative units (a time-weighted index starting at 1) and is what `maxDrawdown`, `volatility` and `worstYear` use; `xirr` uses the actual contribution flows plus the final value; `cagr` is reported only for single-contribution strategies (`lump > 0 && monthly == 0 && trancheMonths == 1`), else `null`.

- [ ] **Step 1: Write failing tests (metrics):** `xirr` of −1000 at 2020-01-01 and +1210 at 2022-01-01 ≈ 0.1 (±1e-6; 731 days); two contributions with a known closed-form solution; all-negative flows → `null`; `cagr(100, 121, 730)` ≈ 0.1; `maxDrawdown([1,1.2,0.9,1.5])` = −0.25; monotone rising → 0; `annualVolatility` of a constant series = 0 and of a hand-computed 4-point series equals the test's explicit arithmetic; `worstRollingYear` on a 3-year hand-made series equals the known worst 12-month return; series shorter than a year → `null`.
- [ ] **Step 2: Write failing tests (backtest):** one slice `core` weight 100, a flat index of 1 → `finalValue == invested`, `xirr ≈ 0`, `maxDrawdown 0`; index doubling over two years with a lump on day 1 → `finalValue == 2 × lump`, `cagr ≈ 0.4142` (±1e-3); DCA of 1000 per month for 12 months on an index rising linearly from 1 to 2 equals the hand-computed units × final index (write the arithmetic in the test); tranche schedule: lump 600000, `trancheMonths 6`, `monthly 0` → six 100000 contributions on the first trading day of six consecutive months (assert `invested` after month 1 and 6 via `valueSeries`); a `cash` weight keeps its share constant; `satellite` follows `core`; yearly rebalance returns a 50/50 core/bond mix to 50/50 on the anniversary (assert the unit counts after the rebalance); `alignOnCommonDates` drops dates missing from any series; fewer than 2 common dates → `null`; a series with a gap (missing day in `bond`) produces no `NaN` anywhere in `valueSeries`.
- [ ] **Step 3: Run** `bunx vitest run src/planner/backtest src/planner/metrics` → FAIL. **Step 4: Implement** (pure; month iteration with a UTC date helper; keep functions small). **Step 5: Run** → PASS. **Step 6: Commit** `feat(planner): backtest simulation with XIRR, drawdown, volatility and worst year`.

### Task 7: Instrument selection

**Files:**
- Create: `src/planner/selection.ts`, `src/planner/selection.test.ts`

**Interfaces:**
- Consumes: `CATEGORY_MEMBERS`, `ELIGIBILITY`, `PriceStats`, `EtfUniverseRow`.
- Produces: `type Category = "core" | "bond" | "dividend"`; `type Candidate = { symbol: string; name: string; stats: PriceStats }`; `type CategorySelection = { category: Category; primary: Candidate | null; alternate: Candidate | null; rejected: { symbol: string; reasons: string[] }[] }`; `isEligible(category: Category, candidate: Candidate, asOf: string): string[]` (reasons it fails; `[]` = eligible; reasons: `stale`, `short_history`, `low_turnover`, `excluded_name`); `selectInstruments(candidates: readonly Candidate[], asOf: string): Record<Category, CategorySelection>` (per category: eligible members sorted by longest history, then higher median turnover, then symbol; first = primary, second = alternate); `medianTurnover(stats: PriceStats): number`; `discoverCandidates(universe: readonly EtfUniverseRow[]): { symbol: string; name: string; hint: Category | null }[]` — ETFs in the universe not in any `CATEGORY_MEMBERS` list and not excluded by name, with a name-based hint (`債` or symbol ending `B` → bond; `高股息|高息|優息|股息|息收|配息|收益` → dividend; `台灣50|臺灣50|台50|中型100|MSCI台灣|台灣領袖|台灣加權|台灣全市場` → core; otherwise `null`), for the "please confirm" report (never auto-added).

- [ ] **Step 1: Write failing tests** using hand-built `PriceStats` (history years computed from `firstDate` vs `asOf`, 365.25-day years): all three failure reasons are reported; boundary cases (exactly 5.0 years passes, one day less fails; median turnover exactly 100,000,000 passes; last price exactly 10 days old passes, 11 fails); a core member with 10 years and one with 20 years → the 20-year one is primary and the other alternate; equal history → higher turnover wins; no eligible member → `primary: null` and the rejected list with reasons; the real 2026-10-14 numbers from the spec (0050 / 006208 / 0051 turnovers 9.8e9 / 8.5e8 / 1.05e7) → 0051 rejected `low_turnover`; `isEligible` rejects a name matching the excluded pattern even with perfect stats; `discoverCandidates` returns a new `00xxx`-style bond ETF with hint `bond`, skips existing members and leveraged names, and gives hint `null` for an unclassifiable name.
- [ ] **Step 2: Run** `bunx vitest run src/planner/selection` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(planner): data-driven instrument eligibility and primary selection`.

### Task 8: Ingestion for the category members

**Files:**
- Modify: `src/ingestion/tracked-symbols.ts`, `src/ingestion/run-ingestion.ts`, `src/ingestion/run-ingestion.test.ts`
- Create: `src/ingestion/etf-universe.ts`, `src/ingestion/etf-universe.test.ts`

**Interfaces:**
- `TRACKED_SYMBOLS` becomes the union of every `CATEGORY_MEMBERS` symbol (deduplicated, stable order) — import from `@/planner/rules/instruments`.
- `BACKFILL_START` moves from `2010-01-01` to `2003-01-01` (0050 lists on 2003-06-30).
- Gap backfill: for a tracked symbol whose earliest stored bar is later than `BACKFILL_START` plus 31 days and whose `etf_universe.history_checked_at` is `null` (symbols without a universe row are skipped until the universe has been refreshed), fetch `[BACKFILL_START, earliest − 1 day]` once as action `prices:<symbol>:history` (and the corporate actions from `BACKFILL_START`), then `markHistoryChecked` whether or not bars came back (a symbol listed after 2003 returns none and is never refetched).
- Per-run cap: at most `MAX_SYMBOL_BACKFILLS_PER_RUN = 3` symbols run their first-time or gap backfill in one ingestion run (each costs 3 FinMind requests); the rest are `skipped` with detail `backfill deferred` and continue on the next run. Daily top-ups of already-backfilled symbols are not capped.
- `refreshEtfUniverse(deps: { db: Db; finmind: FinMindClient; now: Date }): Promise<Outcome>` in `src/ingestion/etf-universe.ts`: calls `fetchStockInfo` and `upsertEtfUniverse`; runs from `run-ingestion` as action `etf_universe` at most once per 7 days (skip when the newest `etf_universe.updated_at` is younger than 7 days) and never fails the run.

- [ ] **Step 1: Write failing tests** (existing ingestion tests use injected fakes; follow their style): tracked symbols include `00679B` and `0056` and have no duplicates; a symbol with no stored bars triggers a backfill starting `2003-01-01`; a symbol with a universe row, `history_checked_at` null and earliest stored bar `2010-01-04` triggers one gap fetch ending `2010-01-03` and is marked checked even when 0 bars return (a second run does not refetch); a symbol with no universe row triggers no gap fetch; with five symbols needing backfill only three are fetched and two are `skipped` with `backfill deferred`; `etf_universe` runs once, then is skipped on a second run within 7 days (fake clock), and a FinMind failure there records `failed` without aborting the other actions; the existing assertions about prices/corporate actions still pass.
- [ ] **Step 2: Run** `bunx vitest run src/ingestion` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; full `bun run test`. **Step 5: Commit** `feat(ingestion): track every category member, deeper history, weekly ETF universe`.

### Task 9: Plan service and `POST /api/plan`

**Files:**
- Create: `src/planner/schema.ts`, `src/planner/plan-service.ts`, `src/planner/plan-service.test.ts`, `app/api/plan/route.ts`, `test/api/plan-route.test.ts`

**Interfaces:**
- Consumes: Tasks 3–8 and `getPriceBars`, `getCorporateActions`, `getPriceStats`, `listEtfUniverse`.
- `schema.ts` (Zod, exported): `planRequestSchema` = `{ answers: Record<"age"|"horizon"|"income"|"reserve"|"loss", string>, lump: number, monthly: number, monthlyExpenses: number, existingReserve: number }` — all amounts finite non-negative integers ≤ 1_000_000_000, `lump + monthly > 0`, option ids validated against `QUESTIONS`; `planResponseSchema` (discriminated by `kind`): `{ kind: "plan", profile: Profile, amounts: AmountPlan, instruments: { category: Category; symbol: string; name: string; alternate: string | null }[], rhythm: { trancheMonths: number }, window: { from, to, years: number, symbols: string[] }, scenarios: { lump: BacktestResult; dca: BacktestResult; plan: BacktestResult }, equityOnly: { from: string; years: number; lump: BacktestResult; dca: BacktestResult; plan: BacktestResult } | null, warnings: string[], assumptions: string[] }` or `{ kind: "reserve_only", profile, amounts, warnings, assumptions }` or `{ kind: "insufficient_history", profile, amounts, warnings, assumptions }`.
- `planPortfolio(deps: { db: Db; now: Date }, request: PlanRequest): Promise<PlanResponse>`; throws `DataUnavailableError` (name `DataUnavailableError`, no data in message) when no core primary exists.
- Scenario definitions: with `investable` and the profile's table row, all three scenarios use the same weights, the same `investable` lump and the same `monthly`, `rebalanceYearly: true`, and differ only in timing — `lump`: `trancheMonths = 1` (everything on day 1); `dca`: `trancheMonths = 12` (spread evenly over 12 months); `plan`: `trancheMonths` from `amounts` (the rhythm rule). The comparison is therefore "same total money, different timing" (say so in `assumptions`). Bond slice with no eligible primary → its weight moves to `cash` and `warnings` gets `債券標的暫時沒有符合條件的 ETF，債券部位以現金計算`. `equityOnly` re-scales `core+satellite` and `dividend` weights to 100% (satellite counted as core), runs from the first date core and dividend primaries both have bars, and is `null` when the bond slice weight is 0 *and* the full-window result already starts at the same date (nothing to add). `window.years` = days between `from` and `to` / 365.25 rounded to one decimal; fewer than 365 days of common history → `insufficient_history`.
- `assumptions` (fixed strings, always present): `衛星部位以核心報酬代替，實際風險更高`、`含配息再投入，不計手續費與稅`、`過去表現不代表未來`、`年化報酬含投入時點（資金加權）`.
- Route: `POST`, body parsed with `planRequestSchema` (invalid JSON or schema failure → `400 {"error":"invalid_request"}`), calls `planPortfolio(getDb(), …)`, `DataUnavailableError` → `503 {"error":"data_unavailable"}`, any other error → `500 {"error":"internal_error"}` logged with `safeErrorMessage` only; success `200` via `cachedJson`-style response with `cache-control: no-store`; `export const dynamic = "force-dynamic"`; the request body is never logged.

- [ ] **Step 1: Write failing tests (service, PGlite with inserted synthetic bars/actions/universe for 0050, 0056, 00679B over 3 years):** reserve-only request (gap ≥ lump) returns `kind: "reserve_only"` with no scenarios; a normal level-3 request returns `kind: "plan"` with `window.symbols` equal to the three primaries, `from` equal to the latest of the three first dates, scenario `invested` equal across `lump`, `dca`, `plan` (same total money) and `plan.finalValue` positive; with the bond ETF's bars removed the bond weight shows as cash and a warning is present; with no core bars → `DataUnavailableError`; bars covering 200 days only → `insufficient_history`; the response parses with `planResponseSchema`. **Route tests:** `{ lump: -1 }`, `{ lump: 0, monthly: 0 }`, a non-integer amount, an unknown option id, and a non-JSON body each → 400 `invalid_request` with `cache-control: no-store`; amounts of `10**12` → 400; a valid request → 200 and the body parses with `planResponseSchema`; the logger mock receives no call containing the request's amounts.
- [ ] **Step 2: Run** `bunx vitest run src/planner/plan-service test/api/plan-route` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `bun run typecheck && bun run build`; start the production server (`bun run start`) and `curl` the route with an invalid body to confirm `400` (the build alone has missed runtime errors before). **Step 5: Commit** `feat(planner): plan service and POST /api/plan`.

### Task 10: Real-data verification and docs

**Files:**
- Create: `scripts/plan-dev.ts`
- Modify: `package.json` (script `plan:dev`), `README.md`

**Interfaces:**
- `bun run plan:dev -- --level 3 --lump 600000 --monthly 15000 --expenses 30000 --reserve 90000 --income stable` prints one readable summary (profile, amounts, selected instruments with their history and turnover, window, and the three scenarios' invested / final value / xirr / max drawdown / worst year / volatility) using the same `planPortfolio` as the route; `--discover` prints `discoverCandidates` for the stored ETF universe; the script prints no secrets and never prints env values.

- [ ] **Step 1: Write a small test** for the script's argument parsing (`parsePlanArgs(argv: string[])`, exported, rejects missing or non-numeric values with a one-line message).
- [ ] **Step 2: Implement the script and README section** (rules live in `src/planner/rules`, how eligibility works, `POST /api/plan` contract with a sample body, limits: no fees/taxes, short bond history, satellite proxy; first-run backfill takes several cron runs because of the per-run cap).
- [ ] **Step 3: Verify on real data.** With the project's Postgres (`docker compose up -d postgres`; never touch other containers) run ingestion repeatedly via `bun scripts/…` or the cron route until the 21 category members have history (the cap means ~7 runs; use the existing dev way to run ingestion, e.g. `curl` the cron route with the secret from `.env` without printing it), then `bun run plan:dev -- --discover` and the example above. Record in the report: the selected primaries (expect 0050 / 00679B / 0056 per the spec's 2026-10-14 check; if different, say why), the window dates, and a hand-check of one number (e.g. 0050 total-return CAGR since 2003 against a manual computation from two prices and the dividends, within 0.5 percentage points). Any mismatch is a finding, not something to paper over.
- [ ] **Step 4: Full gate** `bun run lint && bun run typecheck && bun run test && bun run build && bun run deps:check`. **Step 5: Commit** `docs(planner): plan:dev script and README`.

---

## Self-review notes

- Spec coverage: questionnaire/level/caps/reserveFirst (3); allocation table, reserve months (3, 4); rhythm and tranches (3, 4); eligibility, primaries, discovery report (7, 8); category table in code (3); weekly universe refresh and deeper history (8); total return with distributions (5); XIRR / unit-value metrics, worst year, annual rebalance, satellite proxy, cash at 0 (6); shared window and stock-only longer window (9); warnings for missing bond (9); reserve-only (4, 9); stateless API, no logging of bodies (9); fixed assumptions text (9); bond `除息` dividends (1).
- Not in this plan (3A-2 / 3B): LLM explanations (batch per level × lens), the planner UI, charts. The `etf_universe` discovery report is computed on demand instead of stored (the spec's stored report was a simplification).
- Types: `Slice`, `RiskLevel`, `Profile`, `AmountPlan`, `TrPoint`, `BacktestResult`, `Category`, `CategorySelection` are defined once and reused by name.
