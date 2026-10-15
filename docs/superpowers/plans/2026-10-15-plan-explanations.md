# Plan Explanations (Phase 3A-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store one LLM-written explanation per risk level (1–5) × lens (beginner/pro), built only from a deterministic fact sheet of that level's allocation and historical reference run, validated by the Phase 2A checks, refreshed weekly by the cron run, and served by a cacheable `GET /api/plan/explanation`.

**Architecture:** Phase 3A's `plan-service` gains `planReference` (a lump-only reference backtest of a level's default allocation). A fact sheet is built from it with `factSheetFromText`; a new prompt asks the LLM to rewrite it as `BriefingContent`-shaped JSON; the Phase 2A validators (`checkGrounding`, `findForbiddenPredictions`, `findAdviceWording`, `findLinks`) run through a shared validated-generation core extracted from `produceBriefing`. Results live in a new `plan_explanations` table keyed `(level, lens)` and replaced weekly. The LLM never sees a user's amounts or answers; the screen fills those in deterministically (Phase 3B).

**Tech Stack:** TypeScript, Bun, Zod 4, Drizzle + PGlite tests, Vitest, existing `Llm` adapter (`src/insight/llm.ts`), vinext route handlers.

**Spec:** `docs/superpowers/specs/2026-10-14-muggle-investor-planner-design.md` (「我的決定」: 解釋依「等級 × 視角」批次產生…只用百分比和該等級預設配置的歷史試算數字；沿用階段 2A 的檢查；「過去表現不代表未來」由畫面固定輸出，不由 LLM 寫). Phase 2A reference: `docs/superpowers/plans/2026-10-12-content-engine-backend.md`.

## Decisions made in this plan (flag to the user at hand-off)

- **Reference run:** per level, the default allocation (after the same missing-bond/dividend → cash fallback as `planPortfolio`), a single lump of 1,000,000 TWD on day 1, no monthly money, yearly rebalance, over the common window of the used primaries; plus the same for the equity-only window when `planPortfolio`'s R-P1 rule would return one. Ratios (CAGR, max drawdown, volatility, worst rolling year) do not depend on the amount, so the fact sheet carries no money figures.
- **Refresh rule:** one row per `(level, lens)`; `period_key` is the ISO week (`YYYY-Www`) of the market date the data runs to. A new row replaces the stored one when `prompt_version` is higher, or equal with a later `period_key`. The cron run generates a missing/older one at most once per week per level × lens; an older stored explanation keeps being served until replaced (the response carries `periodKey` and `createdAt` so the screen can show "資料到 …").
- **Not in the LLM text:** the 「過去表現不代表未來」 line and the 「以上為資料整理與教育說明，不構成投資建議」 line stay screen-fixed, exactly as the spec says; the prompt does not ask the LLM to write the former, and keeps the latter rule used by briefings (`DISCLAIMER_RULE`).
- **Content shape:** reuse `briefingContentSchema` (headline, summary, 2–4 sections, takeaway, termIds) so the Phase 2B briefing card component can render it.
- **New glossary terms** (planning category) are drafts of mine and need the user's wording review before launch.

## Global Constraints

- Bun, TypeScript, Biome, Zod 4, Drizzle; every dependency at its latest version (`bun run deps:check` must report nothing).
- Tests first (RED/GREEN evidence), signed commits, no pushing from tasks.
- Traditional Chinese with Taiwan wording; beginner copy short and plain; no buy/sell advice, no predictions of direction, no guarantees, no links.
- `src/insight/**` imports nothing from `app/`; `src/planner/**` stays free of LLM imports.
- Only numbers present in the fact sheet (or plain integers 0–20, or sensible roundings per `checkGrounding`) may appear in LLM output.
- API responses for stored shared content use `cachedJson` with a public cache header; invalid input → 400 `{"error":"..."}`; missing → 404 `not_found`; logging uses `safeErrorMessage` only.
- Gate before each commit: `bun run lint && bun run typecheck && bun run test`; before the last commit also `bun run build && bun run deps:check`. Production-server smoke test for any new route.

## Review Focus

- A level whose bond (or dividend) primary is missing: the fact sheet must say that slice is held as cash; the explanation must not describe a bond holding that does not exist.
- A window shorter than a year, or no core primary: no fact sheet, no LLM call, nothing stored, outcome `skipped` with a reason (never a thrown error that aborts the cron run).
- LLM output that computes a new number (a difference, an average) or predicts: rejected after one repair, nothing stored, the previously stored explanation keeps being served.
- Levels 1–2 have 0% satellite and level 5 has 0% bond: the fact sheet and prompt must not mention a slice with 0%.
- The same week re-run: no second LLM call for a stored `(level, lens, week, version)`.

## File Structure

- Modify `src/insight/pipeline.ts` — split into `produceValidated` (generate → validate → one repair → usage records) and the briefing-specific wrapper `produceBriefing`; no behavior change.
- Modify `src/db/schema.ts`, add `drizzle/0005_*.sql` (generated) — `plan_explanations`.
- Create `src/db/repositories/plan-explanations.ts` (+ test).
- Modify `src/glossary/terms.ts` — planning terms; modify `src/insight/prompts/shared.ts` — `glossaryList`/`PROMPT_TERMS` take the term set.
- Modify `src/planner/plan-service.ts` — export `planReference`; extract the shared market loading so `planPortfolio` and `planReference` use one code path.
- Create `src/insight/facts-plan.ts`, `src/insight/prompts/plan.ts`, `src/insight/generate-plan.ts` (+ tests).
- Create `src/ingestion/plan-explanations.ts` (+ test); modify `src/ingestion/run-ingestion.ts` to call it after briefings.
- Create `src/insight/plan-explanation-service.ts` and `app/api/plan/explanation/route.ts` (+ tests).
- Modify `src/insight/sample-briefing.ts`/`scripts/seed-sample-briefings.ts` for sample plan explanations; README section.

---

### Task 1: Extract the shared validated-generation core

**Files:**
- Modify: `src/insight/pipeline.ts`, `src/insight/pipeline.test.ts`

**Interfaces:**
- Produces: `produceValidated(deps: ValidatedDeps, req: ValidatedRequest): Promise<ValidatedResult>` where `ValidatedDeps = { db; llm; logger; now? }` (same as `ProduceDeps`), `ValidatedRequest = { purpose: string; context: Record<string, string | number>; system: string; prompt: string; facts: FactSheet; weekdaySessions: boolean }` and `ValidatedResult = { status: "ok"; content: BriefingContent; termIds: string[] } | { status: "rejected"; reasons: string[] }`. It performs: generate with `briefingContentSchema`, `llm_usage` recording (including throwing calls, as today), validate (`checkGrounding`, `findForbiddenPredictions({ weekdaySessions })`, `findAdviceWording`, `findLinks`), at most one repair call (existing `repairPrompt`), unknown-glossary-id dropping with the `warn` log, and term-id merging with `findTermsInText`. It does NOT touch `briefings`.
- `produceBriefing(deps, req)` keeps its exact signature and behavior (skip when `hasBriefing`; `purpose = briefing:<kind>:<lens>`; `weekdaySessions: kind !== "weekly"`; save via `saveBriefing`; statuses `saved|skipped|rejected`).
- Both are exported; `BriefingContent` stays the content type.

- [ ] **Step 1: Write failing tests** in `pipeline.test.ts`: `produceValidated` returns `ok` with merged term ids and records one `llm_usage` row per call; returns `rejected` with reasons after a failed repair (two usage rows); an `LlmOutputError` still records usage and propagates; with `weekdaySessions: false` a past-week sentence containing 「週一開盤」 passes while with `true` it is rejected. Existing `produceBriefing` tests must stay green unchanged.
- [ ] **Step 2: Run** `bunx vitest run src/insight/pipeline` → new tests FAIL.
- [ ] **Step 3: Refactor** `pipeline.ts`: move the generate/validate/repair/term logic into `produceValidated`; `produceBriefing` becomes the has/save wrapper around it. Do not change `repairPrompt` wording or any validator.
- [ ] **Step 4: Run** the whole `src/insight` and `src/ingestion` suites → PASS. **Step 5: Commit** `refactor(insight): extract the validated generation core from produceBriefing`.

---

### Task 2: `plan_explanations` table and repository

**Files:**
- Modify: `src/db/schema.ts`; Create: `drizzle/0005_*.sql` (via `bun run db:generate`, committed with its snapshot), `src/db/repositories/plan-explanations.ts`, `src/db/repositories/plan-explanations.test.ts`

**Interfaces:**
- Table `plan_explanations`: `level smallint not null` (check 1..5), `lens` (reuse `briefingLensEnum`), `period_key text not null` (check `~ '^\d{4}-W\d{2}$'`), `prompt_version integer not null`, `model text not null`, `content jsonb not null`, `created_at timestamptz not null default now()`, primary key `(level, lens)`.
- `type PlanExplanation = { level: RiskLevel; lens: Lens; periodKey: string; promptVersion: number; model: string; content: BriefingContent; createdAt: Date }`.
- `savePlanExplanation(db, e: Omit<PlanExplanation, "createdAt"> & { createdAt?: Date }): Promise<{ saved: boolean }>` — validates `content` with `briefingContentSchema` (throws before writing); one atomic upsert that replaces only when `excluded.prompt_version > stored` OR (`=` and `excluded.period_key > stored`).
- `getPlanExplanation(db, level, lens): Promise<PlanExplanation | null>` — validates stored JSON on the way out; schema drift throws `PlanExplanationDriftError` (name set, like `BriefingDriftError`).
- `hasPlanExplanation(db, level, lens, periodKey, promptVersion): Promise<boolean>` — true when a stored row has `prompt_version >= promptVersion` and (`prompt_version > promptVersion` or `period_key >= periodKey`).

- [ ] **Step 1: Write failing tests** (PGlite, follow `briefings.test.ts`): round-trip; a second save with the same version and same/older week → `saved: false`, content unchanged; same version and later week → replaced; higher version and older week → replaced; lower version never replaces; level 0 and 6, bad period key rejected by the database; invalid content throws before writing; `getPlanExplanation` of a drifted row throws `PlanExplanationDriftError`; `hasPlanExplanation` truth table for the cases above.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** schema, generate the migration with the repo's `bun run db:generate` (do not hand-edit SQL beyond what drizzle emits; if the check constraints need raw SQL use the same style as `briefings_period_key_check`), repository. **Step 4: Run** `bunx vitest run src/db` → PASS. **Step 5: Commit** `feat(db): plan_explanations table and repository`.

---

### Task 3: Planning glossary terms and a term-set parameter for the prompts

**Files:**
- Modify: `src/glossary/terms.ts`, `src/glossary/glossary.test.ts` (if it pins counts), `src/insight/prompts/shared.ts`, tests that import `PROMPT_TERMS`/`glossaryList`

**Interfaces:**
- Add curated terms (category `planning`, same entry shape and beginner/pro fields as the existing planning entries; ids exactly): `emergency-fund` (緊急預備金), `rebalance` (再平衡), `bond-etf` (債券 ETF), `dividend-etf` (高股息 ETF), `total-return` (含息報酬), `xirr` (資金加權年化報酬). Beginner wording plain and short, with one everyday analogy where it helps, never advice; pro wording precise. Existing `etf` (market category) is reused for plan prompts.
- `shared.ts`: `glossaryList(terms: readonly GlossaryTerm[] = PROMPT_TERMS): string` and export `PLAN_PROMPT_TERMS` = planning-category terms plus `etf`. Briefing prompts keep `PROMPT_TERMS` unchanged (the daily/weekly prompt text must stay byte-identical so their prompt versions need no bump — add a test comparing `glossaryList()` against the previous output for the market/flow/limit set).

- [ ] **Step 1: Write failing tests**: the six ids exist with non-empty beginner and pro text and category `planning`; `PLAN_PROMPT_TERMS` contains them plus `etf` and no market/flow/limit-only term except `etf`; `glossaryList()` without arguments is unchanged for the briefing prompts; every glossary id is unique (existing test).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `bunx vitest run src/glossary src/insight/prompts` → PASS. **Step 5: Commit** `feat(glossary): planning terms for the plan explanations`.

---

### Task 4: `planReference` in the plan service

**Files:**
- Modify: `src/planner/plan-service.ts`, `src/planner/plan-service.test.ts`

**Interfaces:**
- Consumes: Tasks 3–10 of Phase 3A (`loadCandidates`, `selectInstruments`, `runBacktest`, `ALLOCATION_TABLE`, `equityWeights`, …).
- Produces (exported from `plan-service.ts`): 
  - `type ReferenceMetrics = { cagr: number | null; maxDrawdown: number; volatility: number; worstYear: number | null }`
  - `type PlanReference = { level: RiskLevel; asOf: string; weights: Record<Slice, number>; instruments: { category: Category; symbol: string; name: string }[]; warnings: string[]; window: { from: string; to: string; years: number }; metrics: ReferenceMetrics; equityOnly: { from: string; years: number; metrics: ReferenceMetrics } | null }`
  - `planReference(deps: { db: Db; now: Date }, level: RiskLevel): Promise<PlanReference | null>` — `null` when the common window is shorter than `MIN_WINDOW_DAYS`; throws `DataUnavailableError` when no core primary exists. Strategy: lump `REFERENCE_LUMP = 1_000_000`, monthly 0, `trancheMonths: 1`, `rebalanceYearly: true`, the level's `ALLOCATION_TABLE` row after the same bond/dividend → cash fallback and warnings as `planPortfolio`. `equityOnly` follows the same R-P1 rule and weights as `planPortfolio`.
- Refactor: extract the market loading and weights fallback shared by both functions (e.g. `resolveMarket(db, asOf, table)` returning primaries, weights, warnings, series) so there is one code path; `planPortfolio` output must not change (existing tests are the net).

- [ ] **Step 1: Write failing tests** (reuse `test/helpers/plan-fixtures.ts`): level 3 returns weights summing to 100, three instruments, `window.from` equal to the latest first date of the used primaries, `metrics.cagr` non-null and `maxDrawdown ≤ 0`; level 1 with the bond bars removed → bond weight moved to cash, warning present, no bond instrument; 200 days of history → `null`; no core bars → `DataUnavailableError`; level 5 (0% bond) → `equityOnly` is `null` only if its start equals the main start (R-P1), otherwise present with its own `from`.
- [ ] **Step 2: Run** `bunx vitest run src/planner/plan-service` → FAIL. **Step 3: Implement.** **Step 4: Run** the whole `src/planner` and `test/api` suites → PASS (proves `planPortfolio` unchanged). **Step 5: Commit** `feat(planner): reference run per risk level`.

---

### Task 5: Plan fact sheet, prompts and generation

**Files:**
- Create: `src/insight/facts-plan.ts`, `src/insight/prompts/plan.ts`, `src/insight/generate-plan.ts`, with `*.test.ts` each

**Interfaces:**
- `facts-plan.ts`: `buildPlanFacts(reference: PlanReference): FactSheet` — `periodKey` = ISO week key of `reference.asOf`; text built with `factSheetFromText`. Lines (Traditional Chinese, labels fixed, numbers copied from the reference with the existing `num`/`pct` helpers, percentages for weights as integers like `核心：市值型 ETF 45%`): level name and number (1 保守 … 5 進取); one line per slice with weight > 0 and its instrument (`name（symbol）`) — a bond/dividend slice held as cash is written as `現金 …%` plus the warning text; no line for a 0% slice; 資料期間 `from 至 to（years 年）`; the reference-run metrics (`年化報酬率`, `最大回撤`, `年化波動度`, `最差滾動十二個月` omitted when null, with `%`), stated as a one-time historical run with yearly rebalancing and distributions reinvested; the equity-only block (own period and metrics, labelled 只有股票） when present; `資料到 asOf`. No money amounts. Throws for a reference with weights not summing to 100.
- `prompts/plan.ts`: `PLAN_PROMPT_VERSION = 1`; `buildPlanPrompts(lens: Lens, level: RiskLevel, facts: FactSheet): { system: string; prompt: string }` using the shared pieces (`numberRules`, `BANNED_WORDS`, `NO_ADVICE_RULE`, `DISCLAIMER_RULE`, `LANGUAGE_RULE`, `BEGINNER_STYLE_RULES`, `PRO_TERM_RULE`, `outputFields`, `glossaryList(PLAN_PROMPT_TERMS)`). Content rules: describe only what the allocation is and how this exact mix behaved in the stated historical run; every sentence about results is past tense with the figures and their labels copied from FACTS; explain what each held slice is for; explain max drawdown and worst year in plain words for the beginner lens (title the plain-language section 「用白話看這個配置」); the pro lens compares risk and return figures side by side without computing differences; do not write whether results will repeat, do not give amounts, product picks to buy, timing, or advice (those words come from the registry); do not mention a 0% slice; if FACTS says a slice is held as cash say so.
- `generate-plan.ts`: `generatePlanExplanation(deps: ProduceDeps, input: { reference: PlanReference; lens: Lens }): Promise<ProduceResult>` — builds facts and prompts, skips (no LLM call, status `skipped`) when `hasPlanExplanation(db, level, lens, facts.periodKey, PLAN_PROMPT_VERSION)`; otherwise `produceValidated` with `purpose: "plan:<lens>"`, `weekdaySessions: false`, then `savePlanExplanation`; `saved|skipped|rejected` like `produceBriefing`.

- [ ] **Step 1: Write failing tests**: facts — level 3 text contains `核心` 45%, `債券` 25%, `高股息` 20%, `衛星` 5%, `現金` 5%, the window dates and `年化報酬率` with the reference value; `checkGrounding` of a sentence copying those figures is ok and of one with an invented `12.3%` is not; level 1 has no 衛星 line; a bond-held-as-cash reference produces `現金` 70% (55+15… compute from the weights) and the warning, no 債券 line; the sheet has no digit sequence of an amount; weights not summing to 100 throw. Prompts — snapshot-style assertions that the system prompt contains the banned-word list from the registry, the plan glossary ids, the beginner section title, and (pro) no beginner title; no `{{`/`undefined`. Generation (fake `Llm`, PGlite) — valid output saved once and the second call for the same week makes no LLM call; output with an invented number → one repair then `rejected`, nothing stored, usage rows recorded; output with 「明天可能上漲」 → rejected; an older stored explanation is replaced by the next week's.
- [ ] **Step 2: Run** `bunx vitest run src/insight` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; print the five level fact sheets once against the dev database as a manual check (throwaway script in the scratchpad, not committed) and include them in the report so wording can be eyeballed. **Step 5: Commit** `feat(insight): plan explanation facts, prompts and generation`.

---

### Task 6: Weekly generation in the cron run

**Files:**
- Create: `src/ingestion/plan-explanations.ts`, `src/ingestion/plan-explanations.test.ts`; Modify: `src/ingestion/run-ingestion.ts`, `src/ingestion/run-ingestion.test.ts`

**Interfaces:**
- `generatePlanExplanations(deps: IngestionDeps & { llm: Llm; startedAt: number; budgetMs?: number }, record: Recorder): Promise<void>` — for each level 1–5 and lens in `LENSES` (level-major, so a budget cutoff leaves whole levels done): action name `plan_explanation:<level>:<lens>`; skip with detail `already stored` when `hasPlanExplanation` for the current week key and `PLAN_PROMPT_VERSION`; skip with `run time budget exhausted` using the same start-gate pattern and `BRIEFING_RUN_BUDGET_MS` as briefings; compute `planReference` once per level (lazily, only when a lens still needs it); `null` reference → `skipped` `not enough price history`; `DataUnavailableError` → `skipped` `no eligible core instrument` (never `failed`); an `LlmOutputError`/transport failure follows the same circuit-breaker rule as `generateBriefings` (look at how `LLM_UNAVAILABLE` is set there and reuse it, one shared flag per run); rejected output → `skipped` `rejected: …` like briefings.
- `runIngestion` calls it only in the post-close phase, after `generateBriefings`, and never lets it fail the run.

- [ ] **Step 1: Write failing tests** (fake clock, fake `Llm`, PGlite with the plan fixtures): a post-close run creates 10 rows; a second run in the same week makes no LLM calls; the next ISO week regenerates all 10; an intraday run does nothing; budget spent → remaining actions `skipped` and the run still succeeds; with the LLM throwing once, remaining actions are `skipped` with the unavailable detail and no further calls; no core bars → all `skipped` with the reason and no LLM call; a rejected output for one level × lens does not block the others.
- [ ] **Step 2: Run** `bunx vitest run src/ingestion` → FAIL. **Step 3: Implement.** **Step 4: Run** the full ingestion suite → PASS (existing run-ingestion tests unchanged apart from the new actions appearing in the report). **Step 5: Commit** `feat(ingestion): weekly plan explanations after the briefings`.

---

### Task 7: `GET /api/plan/explanation`

**Files:**
- Create: `src/insight/plan-explanation-service.ts`, `src/insight/plan-explanation-service.test.ts`, `app/api/plan/explanation/route.ts`, `test/api/plan-explanation-route.test.ts`

**Interfaces:**
- `getPlanExplanationWithTerms(db: Db, level: RiskLevel, lens: Lens): Promise<{ explanation: PlanExplanation; terms: Record<string, GlossaryTerm> } | null>` — glossary entries for exactly the cited ids; a drifted row reads as `null` with a `warn` (same rule as `briefing-service`).
- Route: `GET ?level=1..5&lens=beginner|pro` (`lens` defaults to beginner via `lensParamSchema`; `level` required, integer 1–5; anything else → 400 `{"error":"invalid level"}`); 404 `not_found`; 200 via `cachedJson(result, "public, s-maxage=3600, stale-while-revalidate=86400", etag from periodKey+promptVersion+level+lens)`; 500 `internal_error` logged with `safeErrorMessage`; `export const dynamic = "force-dynamic"`.

- [ ] **Step 1: Write failing tests**: service happy path, unknown glossary ids dropped, drifted row → `null`; route 400 for missing/0/6/1.5/`abc` level and bad lens, 404 when none, 200 with the content and terms for a stored row, the cache header present, ETag/`If-None-Match` → 304 if `cachedJson` supports it (follow `latest` briefing route tests).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `bun run build`; start the production server and `curl` the route (invalid level → 400; valid level with no row → 404; after seeding one sample row in the dev DB → 200); stop the server. **Step 5: Commit** `feat(api): plan explanation endpoint`.

---

### Task 8: Sample data, README and real-data check

**Files:**
- Modify: `src/insight/sample-briefing.ts`, `scripts/seed-sample-briefings.ts` (and tests), `README.md`

**Interfaces:**
- `buildSamplePlanExplanation(level: RiskLevel, lens: Lens): BriefingContent` — fixed placeholder text prefixed with `SAMPLE_PREFIX`, quoting only the level's allocation percentages from `ALLOCATION_TABLE` (so it cannot misstate numbers), valid under `briefingContentSchema`; `seed-sample-briefings` also writes the 10 sample rows with model `sample` and `prompt_version` 0 (so any real row replaces them).

- [ ] **Step 1: Write failing tests** for the sample builder (schema-valid for all 10 combinations, only prefixed text, percentages equal the table) and that seeding is idempotent and a real row (version ≥ 1) replaces a sample row.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, add a README section (how explanations are generated and refreshed, the endpoint contract with a sample response, the rules the LLM output is held to, what the screen must add itself: the two fixed disclaimers and user amounts). **Step 4: Verify on real data**: run `planReference` for all five levels against the dev Postgres and record the metrics in the report next to a hand-check of one number (the level-3 `maxDrawdown` from the 0050/00679B/0056 series by an independent query is enough); without a live LLM, run `generatePlanExplanation` with a scripted fake `Llm` that copies the fact lines to prove the validators accept a faithful rewrite and reject an invented figure on the real fact sheet. **Step 5: Full gate** `bun run lint && bun run typecheck && bun run test && bun run build && bun run deps:check`; **commit** `docs(planner): plan explanation samples and README`.

---

## Self-review notes

- Spec coverage: batch per level × lens (Tasks 5–6); only percentages and the default allocation's historical numbers, no user data (Tasks 4–5); 2A checks reused (Task 1, 5); fixed disclaimers screen-side (header decision, README Task 8); refresh/invalidation left to implementer by the spec → weekly + prompt version (Tasks 2, 6); cacheable shared serving (Task 7).
- Not in this plan (Phase 3B): the planner UI, charts, questionnaire flow, rendering explanations, the live LLM check (still outstanding, as for briefings), rate limiting.
- Types: `PlanReference`, `ReferenceMetrics`, `PlanExplanation`, `ValidatedResult` are defined once and reused by name; `RiskLevel`, `Lens`, `BriefingContent`, `FactSheet`, `ProduceDeps`, `ProduceResult` come from existing modules.
