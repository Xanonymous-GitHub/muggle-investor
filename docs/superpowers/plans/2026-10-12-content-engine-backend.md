# Content Engine (Phase 2A: backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stored market data into content a beginner or a professional can read: a curated glossary, grounded daily and weekly briefings written by an LLM in two lenses, and a "since your last visit" recap, all served through read APIs. Also closes the Phase 1 gap where a closing digest that failed to parse is never recovered.

**Architecture:** Deterministic code builds a *fact sheet* from parsed snapshots; the LLM only rewrites facts into prose; deterministic validators reject any output that contains a number not in the facts or a next-day prediction. Briefings are generated once per period by the ingestion job, stored in Postgres and shared by all users. Read services and routes only read the database.

**Tech Stack:** TypeScript strict, Zod 4, Drizzle + PGlite tests, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`, latest), Vitest. No new UI in this plan (see "Not in this plan").

**Spec:** `docs/superpowers/specs/2026-10-11-muggle-investor-design.md` (sections: `insight/`, `glossary/`, 不定期使用, Phase 2). Phase 1 plan: `docs/superpowers/plans/2026-10-11-foundation-and-data-layer.md`.

## Not in this plan
- All UI (today page, sectors page, lens switch, term chips, recap card, offline caching) is **Phase 2B**, planned after this plan lands, so its screens can be designed against real briefing output.
- The ask-AI chat (Phase 4), planner (Phase 3), accounts and rate limiting of public routes (before public launch).

## Global Constraints

- All dependencies at latest versions: `bun run deps:check` must report nothing to upgrade after every task that touches `package.json`.
- TypeScript `strict`, `noUncheckedIndexedAccess`; no `any`; Biome clean; Vitest tests never touch the network or the wall clock (inject `now`, fake LLM).
- Server secrets (`DARKFANXING_KEY`, `LLM_API_KEY`, `DATABASE_URL`) never appear in logs, errors, stored rows, prompts or responses.
- **Every number in a stored briefing must appear in its fact sheet** (exact, or a rounding of a fact); anything else is rejected, never stored.
- **No next-day or future-direction predictions** in any briefing (the data source forbids inferring tomorrow from 內外盤差). Briefings are education, not investment advice, and say so once.
- The LLM sees only the fact sheet and the glossary term list; never raw HTML, never the darkfanxing key.
- Trade dates always come from the data, never the wall clock; market time zone `Asia/Taipei`; data settles after 13:35.
- Beginner lens text uses Taiwan Traditional Chinese, avoids unexplained jargon and cites glossary term ids for every professional term it uses.
- Path alias `@/*` → `./src/*`; routes live in `app/api/**/route.ts`; dev server `http://localhost:3000`.
- Public `/api/*` read routes stay unauthenticated in this phase (access control comes later).

## Review Focus

1. **Ungrounded numbers and predictions must never be stored** — a briefing with a number absent from the facts, or a "明天…上漲" sentence, is rejected after one repair retry (Task 6).
2. **Endpoint without JSON-schema support** — a custom OpenAI-compatible endpoint that rejects `response_format`, wraps JSON in code fences, or returns trailing prose must still yield a validated object or a clean failure that stores nothing (Task 3).
3. **Re-parse must not destroy data** — a re-parsed row whose recomputed (kind, group, date, as_of, session) collides with an existing row is left untouched, and raw HTML is never modified (Task 1).
4. **Recap edge dates** — last visit before any stored data, equal to the latest data, in the future, across a holiday gap, or more than 90 days ago (Task 8).
5. **Partial and holiday-shortened weeks** — the weekly briefing is generated only once the week's last trading day has a closed digest; the current incomplete week is never summarised (Task 7).

---

### Task 1: Re-parse maintenance for unparsed or outdated snapshots

**Files:**
- Modify: `src/db/repositories/snapshots.ts`, `src/ingestion/run-ingestion.ts`, `src/db/repositories/snapshots.test.ts`, `src/ingestion/run-ingestion.test.ts`
- Create: `src/ingestion/reparse.ts`, `src/ingestion/reparse.test.ts`

**Interfaces:**
- Consumes: `parseDigest`, `parseSectorBoard`, `parseSectorDetail`, `parseTitle` (`@/sources/darkfanxing`), `PARSER_VERSION` (`src/ingestion/snapshot-row.ts`), `Snapshot` row type.
- Produces:
  - `listReparseCandidates(db: Db, opts: { currentParserVersion: number; limit: number }): Promise<Snapshot[]>` — rows where `parsed IS NULL` or `parser_version < currentParserVersion`, oldest `trade_date` first.
  - `updateSnapshotParse(db: Db, id: string, patch: { tradeDate: string; asOf: string | null; session: SnapshotSession; parsed: unknown; parseError: string | null; parserVersion: number }): Promise<{ updated: boolean }>` — returns `{ updated: false }` (row unchanged) when the new key collides with another row.
  - `reparseSnapshots(deps: { db: Db; logger: Logger }, opts?: { limit?: number }): Promise<{ scanned: number; fixed: number; stillFailing: number; conflicts: number }>` — default limit 20. Per kind uses the matching parser on `rawHtml`. Success: update parsed, dates, session, `parserVersion = PARSER_VERSION`. Failure: store the new `parseError` only, leave `parserVersion` and `parsed` as they were.
  - Ingestion gains a recorded action `reparse` (status `done` with counts in `detail`, `skipped` when nothing to do) that runs in the non-intraday phases **before** the digest catch-up.

- [ ] **Step 1: Write failing tests** (`reparse.test.ts`, PGlite via `createTestDb`):
  - A stored digest row built from `test/fixtures/darkfanxing/digest-2026-10-08.html` with `parsed: null`, `parseError: "x"`, `parserVersion: 1` → after `reparseSnapshots`: `fixed === 1`, row `parsed.market.force === -0.63`, `parseError === null`, `trade_date === "2026-10-08"`, `session === "closed"`.
  - Same for a `sector_board` row (fixture `now-…`) and a `sector_detail` row (fixture `group-quartz-…`, `groupName: "石英元件"`).
  - Garbled raw (`<html>nope</html>`) → `stillFailing === 1`, `parsed` still null, `parseError` non-empty, `parserVersion` unchanged.
  - A row with `parsed` set and `parserVersion === PARSER_VERSION` is not scanned; with `parserVersion = PARSER_VERSION - 1` (use a constant passed through `currentParserVersion`) it is re-parsed.
  - **Collision:** an unparsed row dated `2026-10-08`/`unknown` whose raw re-parses to `closed` while a `closed` row for the same (kind, date) already exists → `conflicts === 1`, the unparsed row is unchanged.
  - `limit: 1` with 3 candidates scans exactly 1.
  - `rawHtml` is never modified (compare before/after).
- [ ] **Step 2:** Run `bun run test src/ingestion/reparse.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the repo functions (catch the unique-violation error code `23505` only; rethrow others) and `reparseSnapshots`.
- [ ] **Step 4:** Add the `reparse` action to `runIngestion` (non-intraday branch, before `catchUp(... "digest" ...)`). Extend `run-ingestion.test.ts`: a pre-stored closed digest with `parsed: null` and the expected date → after a post-close run the action `reparse` is `done` and the digest is parsed; with nothing to re-parse the action is `skipped`; a throwing re-parse is recorded `failed` and the run continues.
- [ ] **Step 5:** `bun run lint && bun run typecheck && bun run test` pass; commit `feat(ingestion): re-parse unparsed and outdated snapshots`.

### Task 2: Glossary module

**Files:**
- Create: `src/glossary/schema.ts`, `src/glossary/terms.ts`, `src/glossary/index.ts`
- Test: `src/glossary/glossary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type GlossaryCategory = "market" | "flow" | "limit" | "planning";
  type GlossaryTerm = {
    id: string;                 // kebab-case, unique
    term: string;               // display name, Traditional Chinese
    aliases: string[];          // other spellings matched in text
    category: GlossaryCategory;
    beginner: { plain: string; analogy: string | null; whyItMatters: string };
    pro: { definition: string; formula: string | null; source: "darkfanxing" | "curated" };
    related: string[];          // term ids
  };
  const glossaryTermSchema: z.ZodType<GlossaryTerm>;
  const GLOSSARY: readonly GlossaryTerm[];
  function getTerm(id: string): GlossaryTerm | undefined;
  function termIds(): string[];
  function findTermsInText(text: string): string[];   // ids, order of first appearance, deduped; longest match wins; matches term and aliases
  ```
- Initial term set (ids → display name). `darkfanxing`-sourced terms: `sector` 族群, `sector-breadth` 上漲／下跌族群數, `force` 力度, `area` 面積, `net-active-buy` 內外盤金額差, `concentration-ratio` 集中倍數, `capital-flow-slope` 近 N 日斜率, `flow-quadrant` 四象限, `limit-locked` 漲停鎖死. `curated`: `taiex-futures` 台指期, `turnover` 成交金額, `change-pct` 漲跌幅, `one-month-change` 近 1 月漲幅, `equal-weight-average` 等權平均, `quadrant-strong` 強勢, `quadrant-weak` 弱勢, `quadrant-turning-strong` 轉強, `quadrant-turning-weak` 轉弱, `limit-up` 漲停, `limit-down` 跌停, `etf` ETF, `dca` 定期定額, `lump-sum` 單筆投入, `cagr` 年化報酬率, `max-drawdown` 最大回撤, `volatility` 波動度.

- [ ] **Step 1: Write failing tests:**
  - every `GLOSSARY` entry passes `glossaryTermSchema`; ids unique; every `related` id exists; every required id above exists (assert the exact list).
  - For each `darkfanxing`-sourced term, `pro.definition` equals the definition of the matching entry in the glossary parsed from `test/fixtures/darkfanxing/digest-2026-10-08.html` via `parseDigest(...).glossary` (use an explicit id→fixture-term map in the test; the match is `===`).
  - `findTermsInText("今天力度為負，內外盤金額差顯示資金流出")` → `["force", "net-active-buy"]`; `findTermsInText("漲停鎖死的有 33 檔")` → `["limit-locked"]` (not `limit-up`, longest match wins); text with no terms → `[]`; repeated mentions are deduped.
  - `beginner.plain` is non-empty and ≤ 80 characters for every term; `beginner.whyItMatters` non-empty.
- [ ] **Step 2:** FAIL. **Step 3:** Implement schema, `terms.ts` data and the three functions. Write beginner texts in plain Taiwan Traditional Chinese with a concrete everyday analogy where it helps (for example 力度 vs 面積: "大公司說了算 vs 人人一票"); `pro` texts for the nine darkfanxing terms are copied verbatim from the fixture; curated pro texts are precise one-sentence definitions with a formula where one exists (`cagr`, `max-drawdown`, `volatility`).
- [ ] **Step 4:** PASS; lint/typecheck. Commit `feat(glossary): curated beginner/pro glossary`. (Wording is content: the user reviews it when reading the final report.)

### Task 3: LLM provider with structured-output fallback

**Files:**
- Modify: `src/config/env.ts`, `src/config/env.test.ts`, `.env.example`, `src/server/services.ts`, `package.json`
- Create: `src/insight/llm.ts`, `src/insight/json-extract.ts`
- Test: `src/insight/llm.test.ts`, `src/insight/json-extract.test.ts`

**Interfaces:**
- Env additions: `LLM_STRUCTURED_OUTPUT: z.enum(["native", "prompt"]).default("native")`, `LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120000)`, `LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000)`.
- Produces:
  ```ts
  type LlmUsage = { inputTokens: number | null; outputTokens: number | null };
  class LlmOutputError extends Error {}   // message never contains prompts or keys
  interface Llm {
    readonly modelId: string;
    generateObject<T>(req: { system: string; prompt: string; schema: z.ZodType<T>; maxRepairs?: number }): Promise<{ object: T; usage: LlmUsage }>;
  }
  function createLlm(opts: { model: LanguageModel; modelId: string; mode: "native" | "prompt"; timeoutMs: number; maxOutputTokens: number }): Llm;
  function createLlmFromEnv(env: Pick<Env, "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL" | "LLM_STRUCTURED_OUTPUT" | "LLM_TIMEOUT_MS" | "LLM_MAX_OUTPUT_TOKENS">): Llm;   // createOpenAICompatible({ name: "llm", baseURL, apiKey }).chatModel(LLM_MODEL)
  function extractJsonObject(text: string): unknown;   // first balanced {...} in text, tolerating ```json fences and trailing prose; throws LlmOutputError if none / invalid JSON
  const getLlm: () => Llm;   // lazy singleton in services.ts
  ```
  `LanguageModel` is the AI SDK type; read the installed `ai` typings for `generateText`, `Output.object({ schema })`, the usage field names and the `ai/test` mock model class (name varies by version).
- Behavior: `native` mode calls `generateText({ model, output: Output.object({ schema }), system, prompt, abortSignal: AbortSignal.timeout(timeoutMs), maxOutputTokens })`. If the call fails with an HTTP 400/422 `APICallError` (endpoint rejects `response_format`), the instance switches itself to `prompt` mode for the rest of the process and retries once. `prompt` mode appends the JSON Schema (`z.toJSONSchema(schema)`) and "只輸出一個 JSON 物件，不要其他文字" to the system prompt, calls `generateText`, runs `extractJsonObject` + `schema.safeParse`; on failure retries up to `maxRepairs` (default 2) with the Zod issue summary appended to the prompt, then throws `LlmOutputError`.

- [ ] **Step 1:** `bun add ai @ai-sdk/openai-compatible` (latest), then `bun run deps:check`.
- [ ] **Step 2: Failing tests** (`json-extract.test.ts`): plain JSON; fenced ```json block; JSON followed by "以上是結果"; nested braces and braces inside strings; two objects → first; no JSON → throws `LlmOutputError`; truncated JSON → throws.
- [ ] **Step 3: Failing tests** (`llm.test.ts`, mock model from `ai/test`, no network): native happy path returns the object and usage; native endpoint throwing a 400 `APICallError` → falls back to prompt mode, second call succeeds, a third call goes straight to prompt mode (assert the number of model calls); prompt mode with fenced JSON succeeds; prompt mode with schema-invalid JSON then valid JSON on the repair call → object returned, second prompt contains the Zod issue text; invalid twice more → throws `LlmOutputError` whose message contains neither the prompt nor the API key; abort/timeout surfaces as `LlmOutputError` (fake `AbortSignal`).
- [ ] **Step 4:** Update `env.test.ts` (new defaults; invalid `LLM_STRUCTURED_OUTPUT` rejected by key name only) and `.env.example`; add `getLlm` to `services.ts`.
- [ ] **Step 5:** Implement. Gate: lint, typecheck, tests. Commit `feat(insight): OpenAI-compatible LLM with structured-output fallback`.

### Task 4: Briefing storage and LLM usage tables

**Files:**
- Modify: `src/db/schema.ts`; generated `drizzle/0002_*.sql` (+ meta)
- Create: `src/insight/lens.ts`, `src/insight/briefing-content.ts`, `src/db/repositories/briefings.ts`, `src/db/repositories/llm-usage.ts`
- Test: `src/db/repositories/briefings.test.ts`, `src/db/repositories/llm-usage.test.ts`, `src/insight/briefing-content.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const LENSES = ["beginner", "pro"] as const;  type Lens = (typeof LENSES)[number];
  const briefingContentSchema = z.object({
    headline: z.string().min(1).max(40),
    summary: z.string().min(1).max(120),            // one sentence, reused by the recap
    sections: z.array(z.object({ title: z.string().min(1).max(24), body: z.string().min(1).max(600) })).min(2).max(4),
    takeaway: z.string().min(1).max(160),
    termIds: z.array(z.string()),                   // glossary ids used in the text
  });
  type BriefingContent = z.infer<typeof briefingContentSchema>;
  type BriefingKind = "daily" | "weekly";
  type Briefing = { kind: BriefingKind; periodKey: string; lens: Lens; promptVersion: number; model: string; content: BriefingContent; createdAt: Date };
  ```
  Tables: `briefings` (`id` uuid, `kind` enum daily|weekly, `period_key` text — `YYYY-MM-DD` for daily, `YYYY-Www` for weekly, `lens` enum, `prompt_version` int, `model` text, `content` jsonb, `created_at`), unique `(kind, period_key, lens)`. `llm_usage` (`id`, `purpose` text, `model` text, `input_tokens` int null, `output_tokens` int null, `created_at`).
  Repos:
  - `saveBriefing(db, b: Omit<Briefing, "createdAt"> & { createdAt?: Date }): Promise<{ saved: boolean }>` — inserts; if a row exists replaces it only when the new `promptVersion` is greater (otherwise `{ saved: false }`).
  - `getBriefing(db, kind, periodKey, lens): Promise<Briefing | null>`; `latestBriefing(db, kind, lens): Promise<Briefing | null>` (greatest `period_key`); `listBriefings(db, kind, fromKey, toKey, lens): Promise<Briefing[]>` ascending; `hasBriefing(db, kind, periodKey, lens, minPromptVersion): Promise<boolean>`.
  - `recordLlmUsage(db, row: { purpose: string; model: string; usage: LlmUsage; createdAt?: Date }): Promise<void>`; `sumLlmUsage(db, since: Date): Promise<{ calls: number; inputTokens: number; outputTokens: number }>`.
- [ ] **Step 1: Failing tests:** content schema rejects empty headline, 41-char headline, 1 or 5 sections, and accepts a valid object; save/get round-trip; saving the same (kind, period, lens) with the same version → `{ saved: false }`, content unchanged; with a higher version → replaced; `latestBriefing` returns the greatest period; `listBriefings` range is inclusive and ascending; `hasBriefing` honours `minPromptVersion`; `sumLlmUsage` ignores rows before `since` and treats null tokens as 0.
- [ ] **Step 2:** FAIL. **Step 3:** Implement schema; `bun run db:generate`; implement repos. **Step 4:** PASS (migration applies in PGlite via `createTestDb`); lint/typecheck. Commit `feat(db): briefings and llm usage tables`.

### Task 5: Fact sheet and output validators

**Files:**
- Create: `src/insight/facts.ts`, `src/insight/grounding.ts`
- Test: `src/insight/facts.test.ts`, `src/insight/grounding.test.ts`

**Interfaces:**
- Consumes: `DigestSnapshot`, `SectorBoard` (`@/sources/darkfanxing`), fixtures.
- Produces:
  ```ts
  type FactSheet = { periodKey: string; text: string; numbers: ReadonlySet<number> };
  function buildDailyFacts(digest: DigestSnapshot, board: SectorBoard | null): FactSheet;
  function extractNumbers(text: string): number[];   // Arabic numerals only (ints/decimals, with sign, comma, %, 億, 點, 檔 suffixes ignored); "-0.63%" → -0.63; times "09:28" → 9 and 28; Chinese numerals ignored
  function checkGrounding(output: string, facts: FactSheet): { ok: boolean; ungrounded: number[] };
  function findForbiddenPredictions(text: string): string[];   // matched snippets
  ```
  `buildDailyFacts` renders `text` as Traditional-Chinese bullet lines from structured fields only: date; futures open/high/low/close/change/changePct; up/down group counts, 力度, 面積 with the previous trading day's values; top 5 gainers and losers (name, 今日%, 近1月%); top 5 net buy and net sell sectors (name, 內外盤金額差 億); quadrant counts and the first 5 transitions; limit-up/down summary lines; and, when `board` is given, total turnover and the 3 highest-turnover sectors. `numbers` = every value `extractNumbers(text)` returns, plus `Math.abs` of each, plus the digits of `tradeDate`.
  `checkGrounding` rules: a number is grounded if it equals a fact (after `abs`), or equals a fact rounded to the number's own number of decimals (1.24 → 1.2 and 1), or is an integer 0–20 (ranks and counts), or is part of a date/time present in the facts. Anything else is `ungrounded`.
  `findForbiddenPredictions` flags: (明天|明日|隔天|下週|下周|下個交易日|未來) within 30 characters of (上漲|下跌|大漲|大跌|看漲|看跌|會漲|會跌|將漲|將跌|反彈|回檔|續漲|續跌|預期|預測|可望); and the words 保證|穩賺|必漲|必跌|一定會漲|一定會跌.
- [ ] **Step 1: Failing tests** against `parseDigest(fixture)` and `parseSectorBoard(fixture)`:
  - `buildDailyFacts(...).text` contains `49349` (futures close), `-619`, `-1.24`, `-0.63`, `0.2`, 矽晶圓 with `-3.36`, 被動元件 with `57.44`, `強勢 43`; `numbers.has(49349)`, `numbers.has(0.63)` (abs), `numbers.has(2026)`, `numbers.has(8)`.
  - `extractNumbers("力度 -0.63%，成交 10,465.0 億，09:28")` → `[-0.63, 10465, 9, 28]`; `extractNumbers("三個族群")` → `[]`.
  - `checkGrounding`: "台指期收 49349 點，下跌 1.2%" → ok (49349 exact; 1.2 rounds from 1.24); "大盤大漲 5.3%" → `{ ok:false, ungrounded:[5.3] }`; "前 3 大族群" → ok (small integer); "2026-10-08" date → ok.
  - `findForbiddenPredictions`: "明天大盤可能上漲" → non-empty; "預期明日走勢向下" → non-empty; "今天資金淨流出" → `[]`; "明天是週五" → `[]`; "穩賺不賠" → non-empty.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat(insight): fact sheet and grounding validators`.

### Task 6: Briefing pipeline and daily briefings

**Files:**
- Create: `src/insight/pipeline.ts`, `src/insight/prompts/daily.ts`, `src/insight/generate-daily.ts`
- Test: `src/insight/pipeline.test.ts`, `src/insight/generate-daily.test.ts`

**Interfaces:**
- Consumes: `Llm` (Task 3), briefing repos and `briefingContentSchema` (Task 4), `FactSheet`, `checkGrounding`, `findForbiddenPredictions` (Task 5), `getTerm`/`termIds` (Task 2).
- Produces:
  ```ts
  type ProduceRequest = { kind: BriefingKind; periodKey: string; lens: Lens; promptVersion: number; system: string; prompt: string; facts: FactSheet };
  type ProduceResult = { status: "saved" | "skipped" | "rejected"; reasons?: string[] };
  type ProduceDeps = { db: Db; llm: Llm; logger: Logger; now?: () => Date };
  function produceBriefing(deps: ProduceDeps, req: ProduceRequest): Promise<ProduceResult>;
  const DAILY_PROMPT_VERSION = 1;
  function buildDailyPrompts(lens: Lens, facts: FactSheet, caveats: string[]): { system: string; prompt: string };
  function generateDailyBriefing(deps: ProduceDeps, input: { digest: DigestSnapshot; board: SectorBoard | null; lens: Lens }): Promise<ProduceResult>;
  ```
  `produceBriefing` flow: if `hasBriefing(kind, periodKey, lens, promptVersion)` → `skipped` with no LLM call. Otherwise `llm.generateObject` with `briefingContentSchema`, record usage (`purpose = "briefing:<kind>:<lens>"`). Validate: `checkGrounding` over `headline + summary + every section title/body + takeaway`, `findForbiddenPredictions` over the same text, and `termIds` filtered to known glossary ids (unknown ids dropped and logged, not an error). On a violation do **one** repair call whose prompt appends the exact ungrounded numbers / matched snippets and asks for a rewrite using only the facts; a second violation → `rejected` (reasons listed), nothing saved. On success `saveBriefing` with `model = llm.modelId`.
  `buildDailyPrompts`: system prompt (Traditional Chinese) fixes the role, states the rules (only numbers from FACTS, no predictions, one sentence stating this is education not investment advice inside the takeaway or last section, list of allowed glossary term ids with display names), embeds the data caveats verbatim; lens-specific rules — **beginner:** short sentences, each professional term used must be in `termIds`, include a section titled「這對你意味著什麼」in plain words with an everyday analogy; **pro:** precise indicator language, cite figures, discuss 力度 vs 面積 divergence, flow quadrant moves, limit-lock concentration. `prompt` = the fact sheet text.
- [ ] **Step 1: Failing tests** (`pipeline.test.ts`, fake `Llm` returning scripted objects, PGlite):
  - valid output → `saved`, row stored, one usage row recorded, `model` stored.
  - first output contains `5.3%` not in the facts → repair call made; the repair prompt contains `5.3`; second output valid → `saved`, 2 usage rows.
  - both outputs ungrounded → `rejected`, `reasons` mention the numbers, **nothing stored**, 2 usage rows.
  - output with "明天大盤將上漲" → repaired/rejected the same way.
  - unknown `termIds: ["force","nope"]` → stored content has `["force"]`.
  - existing briefing with the same version → `skipped`, fake LLM call count 0; existing with lower version → regenerated and replaced.
  - the system/user prompts passed to the fake LLM contain the facts text and contain neither `<html` nor the string `dO8m` nor the LLM API key.
- [ ] **Step 2: Failing tests** (`generate-daily.test.ts`): with `parseDigest(fixture)`, `generateDailyBriefing` for each lens passes `periodKey = "2026-10-08"`, `kind = "daily"`, the lens-specific rules (beginner prompt contains "這對你意味著什麼"; pro prompt does not), and the digest's `caveats` text.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS. Commit `feat(insight): grounded daily briefing pipeline`.

### Task 7: Weekly briefings

**Files:**
- Create: `src/insight/week.ts`, `src/insight/facts-weekly.ts`, `src/insight/prompts/weekly.ts`, `src/insight/generate-weekly.ts`
- Test: `src/insight/week.test.ts`, `src/insight/facts-weekly.test.ts`, `src/insight/generate-weekly.test.ts`

**Interfaces:**
- Produces:
  ```ts
  function isoWeekKey(date: string): string;                 // "2026-10-08" → "2026-W41"
  function weekRange(weekKey: string): { from: string; to: string };   // Monday..Sunday
  function isWeekComplete(weekKey: string, holidays: MarketHoliday[], latestClosedDate: string | null): boolean;
    // true when latestClosedDate is within the week and no trading day of that week is after it
  type WeeklyDay = { digest: DigestSnapshot; dailySummary: string | null };
  function buildWeeklyFacts(weekKey: string, days: WeeklyDay[]): FactSheet;
  const WEEKLY_PROMPT_VERSION = 1;
  function generateWeeklyBriefing(deps: ProduceDeps, input: { weekKey: string; days: WeeklyDay[]; lens: Lens }): Promise<ProduceResult>;
  ```
  `buildWeeklyFacts` text: one line per day (date, futures close, change, changePct, 力度, 面積, up/down groups); the week's index change = `(lastClose − (firstClose − firstChange)) / (firstClose − firstChange) × 100` rounded to 2 decimals; sectors that appeared most often in `topGainers` / `topLosers` across the week (name, count); cumulative 內外盤差 for sectors listed in `netBuy`/`netSell` on any day, labelled "上榜累計"; sectors that changed quadrant during the week; each day's `dailySummary` when present. `numbers` as in Task 5. Uses the same `produceBriefing` with `kind: "weekly"`, `periodKey: weekKey`.
- [ ] **Step 1: Failing tests:** `isoWeekKey("2026-01-01")` → `"2026-W01"`, `isoWeekKey("2026-12-31")` → `"2026-W53"` (verify the true ISO week by calculation and assert it), `isoWeekKey("2026-10-11")` → `"2026-W41"`; `weekRange("2026-W41")` → `{from:"2026-10-05", to:"2026-10-11"}`. `isWeekComplete("2026-W41", holidays, "2026-10-08")` is **false** on a normal week where Friday 10-09 would be a trading day, but **true** with the real fixture holiday list (10-09 is 國慶補假) — build `holidays` from `test/fixtures/twse/holiday-schedule.json` via the TWSE client mapping; also true for latestClosed `2026-10-09` in a week without holidays; false when `latestClosedDate` is null or in another week. `buildWeeklyFacts` with two synthetic days made by modifying the parsed fixture digest (date/close changed) → asserts the computed week change and a "上榜累計" line; its `numbers` contain the computed week change. `generateWeeklyBriefing` happy path with a fake LLM stores a `weekly` briefing under key `2026-W41`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (date math in UTC strings only; no local-time `Date` construction). **Step 4:** PASS. Commit `feat(insight): weekly briefings`.

### Task 8: Ingestion generates briefings

**Files:**
- Modify: `src/ingestion/run-ingestion.ts`, `src/ingestion/run-ingestion.test.ts`, `src/server/services.ts` (pass `llm` into ingestion deps), `app/api/cron/ingest/route.ts`, `src/db/repositories/snapshots.ts`
- Test: extend `run-ingestion.test.ts`, `snapshots.test.ts`

**Interfaces:**
- Consumes: `generateDailyBriefing`, `generateWeeklyBriefing`, `isWeekComplete`, `isoWeekKey`, `Llm`.
- Produces:
  - `IngestionDeps` gains `llm: Llm`.
  - `getClosedSnapshot(db, kind: "digest" | "sector_board", tradeDate: string): Promise<Snapshot | null>` (latest `captured_at` among `closed`, `parsed IS NOT NULL`).
  - `listClosedSnapshots(db, kind, fromDate, toDate, opts?: { parsedOnly?: boolean })` — `parsedOnly: true` ignores unparsed rows when picking the latest per date (closes the Phase 1 deferred minor).
  - Recorded actions in non-intraday phases, after the board catch-up: `briefing:daily:<lens>` for the settled date `expected`, plus catch-up for up to the 4 most recent earlier closed digests lacking a briefing (oldest first; each is a separate recorded action named `briefing:daily:<lens>:<date>`); `briefing:weekly:<lens>` when `isWeekComplete(isoWeekKey(expected), holidays, expected)`. A date whose digest is missing or unparsed → `skipped`. Any `rejected` → `skipped` with the reasons in `detail`; a thrown LLM error → `failed`. LLM failures never affect other actions.
  - Order of day processing and `expected` come from the existing `lastSettledTradeDate` result.
- [ ] **Step 1: Failing tests** (PGlite, fake `Llm` scripted to return a valid object for any prompt, fixtures as in existing tests): post-close run with a stored closed digest → actions `briefing:daily:beginner` and `briefing:daily:pro` are `done` and two daily briefings exist for `2026-10-08`; running again → both `skipped` (LLM call count unchanged); week complete case (2026-W41 with the real holiday fixture and a closed digest on 10-08) → `briefing:weekly:*` `done`; incomplete week (no holiday rows, latest closed on a Wednesday) → no weekly action; LLM throwing → those actions `failed`, `digest`/`sector_board` actions still `done`; an earlier unbriefed closed digest (insert a second fixture-derived digest dated `2026-10-07`) is briefed in the same run, a run with 6 such dates briefs only 4 + the current one; unparsed digest → briefing action `skipped`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; update the cron route's dependency construction. **Step 4:** PASS. Commit `feat(ingestion): generate daily and weekly briefings`.

### Task 9: Recap service and API

**Files:**
- Create: `src/recap/recap-service.ts`, `app/api/market/recap/route.ts`
- Test: `src/recap/recap-service.test.ts`, `test/api/market-recap-route.test.ts`

**Interfaces:**
- Consumes: `listClosedSnapshots(..., { parsedOnly: true })`, `listBriefings`, `getHolidays`, `isoWeekKey`, `weekRange`, `isWeekComplete`, `digestSnapshotSchema`, `marketJson`/`errorJson`.
- Produces:
  ```ts
  const RECAP_MAX_DAYS = 90;
  type RecapDay = { tradeDate: string; futuresClose: number | null; futuresChangePct: number | null; force: number; breadth: number; upGroups: number; downGroups: number; summary: Record<Lens, string | null>; coveredByWeek: string | null };
  type RecapWeek = { weekKey: string; from: string; to: string; briefings: Record<Lens, BriefingContent | null> };
  type Recap =
    | { kind: "up-to-date"; latestTradeDate: string | null }
    | { kind: "recap"; from: string; to: string; truncated: boolean; missedTradingDays: number; days: RecapDay[]; weeks: RecapWeek[];
        cumulative: { futuresChangePct: number | null }; quadrantShift: { from: QuadrantCounts; to: QuadrantCounts } | null };
  function getRecap(db: Db, input: { since: string; now: Date }): Promise<Recap>;
  ```
  Rules: `since` = the trade/visit date the client last saw (exclusive). Latest data date `L` = latest closed parsed digest; no data → `up-to-date` with `latestTradeDate: null`. `since >= L` → `up-to-date`. Otherwise days = closed parsed digests with `tradeDate > since` and (if the span exceeds `RECAP_MAX_DAYS` calendar days) only the last 90 days (`truncated: true`). `summary[lens]` = daily briefing `content.summary` for that date or null. A week fully inside the range whose weekly briefings exist (either lens) is added to `weeks`; each of its days gets `coveredByWeek = weekKey`. `cumulative.futuresChangePct` = `(lastClose − (firstClose − firstChange)) / (firstClose − firstChange) × 100`, null when any futures value is missing. `quadrantShift` = first day's `quadrant.counts.today` → last day's, null when either is missing. `missedTradingDays = days.length`.
  Route `GET /api/market/recap?since=YYYY-MM-DD`: invalid format → 400 `{error:"invalid since"}`; `since` later than today (Taipei) → 400; otherwise 200 JSON with `x-data-trade-date` = `L`; `cache-control` via `marketJson` using the current phase.
- [ ] **Step 1: Failing tests** (PGlite, digest fixtures modified to different dates, daily/weekly briefings inserted directly):
  - three closed digests 10-06, 10-07, 10-08, `since = "2026-10-05"` → `days.length === 3`, `cumulative.futuresChangePct` equals the hand-computed value from the fixture numbers, `quadrantShift` present.
  - `since = "2026-10-08"` → `up-to-date`; `since` later than `L` → `up-to-date`; empty DB → `up-to-date` with `latestTradeDate: null`.
  - `since` far before the earliest stored date → returns everything stored, `truncated: false`; a 120-day span with data on every day → `truncated: true` and `days[0].tradeDate` within 90 days of `L`.
  - **holiday gap:** since 2026-10-07 with data on 10-08 only (10-09 holiday, weekend) → one day, `missedTradingDays === 1`.
  - week coverage: all of 2026-W41's closed digests inside the range and a weekly briefing stored → `weeks.length === 1`, each day `coveredByWeek === "2026-W41"`; no weekly briefing → `weeks` empty and days uncovered.
  - unparsed latest closed row for a date is ignored in favour of an earlier parsed one.
  - route: 400s for `since=abc`, `since=2999-01-01`; 200 shape for a valid request; header `x-data-trade-date`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Commit `feat(recap): since-last-visit recap service and API`.

### Task 10: Briefing and glossary read APIs

**Files:**
- Create: `src/insight/briefing-service.ts`, `app/api/briefings/latest/route.ts`, `app/api/briefings/daily/[date]/route.ts`, `app/api/briefings/weekly/[week]/route.ts`, `app/api/glossary/route.ts`, `app/api/glossary/[id]/route.ts`
- Test: `src/insight/briefing-service.test.ts`, `test/api/briefings-routes.test.ts`, `test/api/glossary-routes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type BriefingResponse = { briefing: Briefing; terms: Record<string, GlossaryTerm> };   // terms = glossary entries for briefing.content.termIds
  function getLatestBriefing(db: Db, lens: Lens): Promise<BriefingResponse | null>;
  function getDailyBriefing(db: Db, date: string, lens: Lens): Promise<BriefingResponse | null>;
  function getWeeklyBriefing(db: Db, weekKey: string, lens: Lens): Promise<BriefingResponse | null>;
  ```
  Routes (all `GET`, JSON): `/api/briefings/latest?lens=beginner|pro` (default `beginner`), `/api/briefings/daily/{YYYY-MM-DD}?lens=`, `/api/briefings/weekly/{YYYY-Www}?lens=`, `/api/glossary` (`{ terms: GlossaryTerm[] }`), `/api/glossary/{id}`. Validate params with Zod (`lens` enum, date and week regexes, id `^[a-z0-9-]{1,48}$`); invalid → 400 `{error}`; unknown → 404. Briefing responses carry `x-data-trade-date` (daily: the date; weekly: the week's last day; latest: its period end) and `cache-control: public, s-maxage=300, stale-while-revalidate=600`; glossary responses `public, max-age=3600`.
- [ ] **Step 1: Failing tests:** latest returns the greatest daily period and includes `terms` for exactly the ids in `termIds`; lens selects the right row; unknown date → null/404; bad lens `?lens=expert` → 400; bad date `2026-13-45` → 400 (reject impossible calendar dates, not only bad shapes); glossary list length equals `GLOSSARY.length`; glossary id `force` → 200, `nope` → 404, `../x` → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (reuse `errorJson`/`marketJson` patterns; routes call `getDb()` lazily). **Step 4:** PASS. Commit `feat(api): briefing and glossary read endpoints`.

### Task 11: Docs, dev script and end-to-end check

**Files:**
- Create: `scripts/generate-briefing.ts`
- Modify: `README.md`, `.env.example`, `package.json` (script `briefing:dev`), `docs/superpowers/specs/2026-10-11-muggle-investor-design.md` (note the 2A/2B split under Phase 2)

- [ ] **Step 1:** `scripts/generate-briefing.ts [date]` loads env, builds the real `Llm` and DB, generates the daily briefings for the given (or latest closed) date for both lenses, and prints status, headline and token usage per lens — never prompts or secrets.
- [ ] **Step 2:** README: LLM configuration (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_STRUCTURED_OUTPUT`, when to use `prompt`), the briefing/recap/glossary endpoints with example curls, how briefings are generated by the cron, the grounding rules, and how to re-run after changing a prompt (bump `*_PROMPT_VERSION`).
- [ ] **Step 3:** Run the whole gate: `bun run lint && bun run typecheck && bun run test && bun run build && bun run deps:check`.
- [ ] **Step 4: Manual check** against local Postgres with the stored 2026-10-08 data and the user's LLM endpoint from `.env`: `bun run briefing:dev` → both lenses `saved`; `curl localhost:3000/api/briefings/latest?lens=beginner | jq '.briefing.content.headline, .terms|keys'` and the `pro` variant; `curl "localhost:3000/api/market/recap?since=2026-10-01" | jq '.kind, .days|length'`; confirm every number in a stored briefing appears in `buildDailyFacts` text (spot-check three). If the LLM endpoint is not configured, record that the manual step was skipped and why.
- [ ] **Step 5:** Commit `docs: content engine usage and dev script`.
