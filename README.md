# muggle-investor
An investment tool to help muggles do their investment

## Development

```sh
bun install
bun run dev        # dev server
bun run build      # production build
bun run start      # serve the production build
bun run test       # unit tests (vitest)
bun run lint       # biome check
bun run format     # biome format --write
bun run typecheck  # tsc --noEmit
bun run deps:check # report outdated dependencies
bun run plan:dev -- --discover   # planner check against the real database, see Planner
```

## Setup

Requires Bun 1.4.3 (pinned in `package.json`, CI and the Dockerfile), Node 22.18+ (to run
`node scripts/migrate.ts` directly) and Docker for the local database.

1. **Environment.** Copy the template and fill in real values:

   ```sh
   cp .env.example .env
   ```

   `.env` is git-ignored and never baked into the Docker image. The server validates it on first
   use; `GET /api/health` answers 503 `{"status":"unhealthy"}` until it is valid. `CRON_SECRET`
   must be at least 32 characters (`openssl rand -hex 32`). `POSTGRES_PASSWORD` is read by
   docker compose; keep it in sync with the password in `DATABASE_URL`.

2. **Database.** Start Postgres (published on `127.0.0.1:5432` only) and apply the migrations:

   ```sh
   docker compose up -d
   bun run db:migrate        # drizzle-kit, for development
   ```

   In production, where drizzle-kit is not installed, use the standalone runner (needs only
   `DATABASE_URL` and the `./drizzle` folder):

   ```sh
   bun run db:migrate:prod   # node scripts/migrate.ts
   # from the Docker image, which ships a bundled copy and the migrations:
   docker run --rm -e DATABASE_URL=postgres://… <image> node migrate.mjs
   ```

3. **Run.**

   ```sh
   bun run dev               # http://localhost:3000
   bun run build && bun run start   # production build, also on http://localhost:3000
   ```

   `bun run start` serves `.output/` (the Nitro node-server build); the Dockerfile builds the
   same output.

## Ingestion

Market data enters only through the ingestion job. Trigger one run by hand:

```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest
```

The response is the run report: the market phase and one entry per step (`done`, `skipped`,
`failed`). Each run decides what to fetch from the current phase, and storage is idempotent, so an
extra or repeated run is harmless. A run makes at most 2 darkfanxing requests (plus retries,
each of which also counts) against the shared quota of 10 per minute.

### Cadence

All times `Asia/Taipei`, weekdays (holidays are handled by the job using the TWSE calendar):

| What | Taipei cron | UTC cron |
| --- | --- | --- |
| Every 5 min, 09:00–12:55 | `*/5 9-12 * * 1-5` | `*/5 1-4 * * 1-5` |
| Every 5 min, 13:00–13:35 (last run catches the 13:35 settlement) | `0-35/5 13 * * 1-5` | `0-35/5 5 * * 1-5` |
| Once after 14:00 (closed digest, prices, corporate actions) | `5 14 * * 1-5` | `5 6 * * 1-5` |
| Again at 14:20 (prices the 14:05 run had no time for) | `20 14 * * 1-5` | `20 6 * * 1-5` |
| Again at 14:35 (the rest of the prices) | `35 14 * * 1-5` | `35 6 * * 1-5` |

Refreshing every symbol's prices takes longer than one run (see
[First run and data volume](#first-run-and-data-volume)), so the post-close work is split over
the three post-close runs; a symbol already up to date costs no request.

### Scheduler options

Any scheduler that can send the bearer request works. Use one, not several.

**Kubernetes CronJob** (supports `timeZone`; create one per schedule line above):

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: muggle-ingest-intraday
spec:
  schedule: "*/5 9-12 * * 1-5"
  timeZone: Asia/Taipei
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: ingest
              image: curlimages/curl:latest
              env:
                - name: CRON_SECRET
                  valueFrom: { secretKeyRef: { name: muggle-investor, key: CRON_SECRET } }
              args:
                - -fsS
                - -X
                - POST
                - -H
                - "Authorization: Bearer $(CRON_SECRET)"
                - http://muggle-investor.default.svc:3000/api/cron/ingest
```

**Vercel Cron.** Add the UTC schedules to `vercel.json` (`crons: [{ "path": "/api/cron/ingest",
"schedule": "*/5 1-4 * * 1-5" }, …]`). Vercel sends a `GET` with `Authorization: Bearer
$CRON_SECRET` when `CRON_SECRET` is set in the project; the endpoint accepts `GET` for this
reason. Check your plan's cron frequency limit: Hobby allows only daily jobs.

**GitHub Actions.** A workflow with `on: schedule` (UTC crons above) can `curl` the deployed URL
with the secret stored as a repository secret. GitHub may delay or skip scheduled runs under load,
so treat it as best effort.

## Content engine

The content engine turns the stored market data into plain-language briefings. It has four parts:
a curated glossary, grounded daily and weekly briefings in two lenses (`beginner` and `pro`), a
"since your last visit" recap, and read-only JSON endpoints for all of them. The LLM only
explains numbers that the engine already computed; it never fetches data or calculates anything.

### LLM configuration

Briefings need an OpenAI-compatible chat endpoint. Set these in `.env` (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | required | Base URL of the endpoint, e.g. `https://llm.example.com/v1` |
| `LLM_API_KEY` | required | Bearer key for the endpoint. Server-only; never logged or stored |
| `LLM_MODEL` | required | Model name sent with each request |
| `LLM_STRUCTURED_OUTPUT` | `native` | `native` or `prompt`, see below |
| `LLM_TIMEOUT_MS` | `120000` | Per-call timeout |
| `LLM_MAX_OUTPUT_TOKENS` | `4000` | Output cap per call |

`native` asks the endpoint for JSON-schema structured output, and switches to `prompt` by itself
(for the rest of the process, with a warning that logs only the HTTP status) the first time the
endpoint answers 400 or 422 to it. A native reply that is not valid JSON or does not match the
schema is retried once through the `prompt` path (with its repairs) for that request only. Set `prompt`
yourself for an endpoint you know does not support JSON-schema output, such as many local or
self-hosted servers: it skips the failing first request. In `prompt` mode the schema goes into the
system prompt, the reply is parsed and validated, and an invalid reply is repaired with up to two
extra calls.

Try your endpoint and prompts by hand against the stored data, without waiting for the cron:

```sh
bun run briefing:dev                 # latest stored closed digest
bun run briefing:dev -- 2026-10-08   # a specific trade date
```

It prints, per lens, the status (`saved`, `skipped` when that version is already stored, or
`rejected` with the reasons), the headline of the stored briefing and the token usage of that run.
It never prints prompts, model replies, keys or the database URL: a failure shows only the error
class and a fixed category (for example `LlmOutputError: model output rejected`), not the error
message. It exits 1 when the date is invalid, the environment is invalid, no digest is stored for
the date, the database fails, or every lens failed.

### Endpoints

All endpoints are `GET` and return JSON. They are **public read routes with no authentication yet**;
access control (invite codes) comes in a later phase. Errors look like `{"error":"not_found"}` with
status 400 (bad input), 404 (nothing stored), 503 or 500. The recap answers 503
`{"error":"unavailable"}` (with `retry-after: 300`, never cached) when closed digests are stored but
none of them can be read; `{"kind":"up-to-date","latestTradeDate":null}` means the database holds
no closed digest at all.

```sh
# Newest daily briefing for a lens (beginner is the default) plus the glossary terms it cites
curl "http://localhost:3000/api/briefings/latest?lens=beginner"
curl "http://localhost:3000/api/briefings/latest?lens=pro"

# A specific trade date, or ISO week (the week's last day is the data date)
curl "http://localhost:3000/api/briefings/daily/2026-10-08?lens=beginner"
curl "http://localhost:3000/api/briefings/weekly/2026-W41?lens=pro"

# The whole glossary, or one term by id
curl "http://localhost:3000/api/glossary"
curl "http://localhost:3000/api/glossary/force"

# What happened after the last trade date the client saw (at most 90 days back)
curl "http://localhost:3000/api/market/recap?since=2026-10-01"
```

A briefing response is `{ "briefing": { periodKey, lens, content: { headline, summary, sections,
takeaway, termIds }, … }, "terms": { <id>: <glossary term> } }`. The recap answers
`{"kind":"up-to-date",…}` when nothing is newer than `since`, otherwise `{"kind":"recap",…}` with one
entry per trading day (with that day's one-sentence summary per lens, `summary: { beginner, pro }`,
each `null` when that lens has no briefing) and the weekly briefings that cover whole weeks.
Briefing and glossary routes send `cache-control` headers (briefings: `public, s-maxage=300,
stale-while-revalidate=600`; glossary: `public, max-age=3600`). The briefing and recap routes also
send an `x-data-trade-date` header with the data date; the glossary routes send only
`cache-control`.

### How briefings are generated

The ingestion cron (`POST /api/cron/ingest`, see [Ingestion](#ingestion)) generates briefings in
every run after the market has closed, as its last step, after the prices. The LLM is therefore
never on the path of price ingestion, and a slow endpoint cannot delay it. In order:

1. The daily briefing for the settled trade date, for each lens.
2. Catch-up: per lens, the 4 most recent earlier closed digests from the previous 14 days that
   have no daily briefing yet, processed oldest first, so a few missed runs heal themselves.
3. The weekly briefing for each lens, once the week's last trading day has its daily briefing
   (a week with a holiday ends on its last open day).

Each briefing is its own action in the run report, so one failure never stops the others. A
per-run circuit breaker protects the run from a dead endpoint: the first LLM call that throws
(timeout, HTTP error, unusable output) skips every remaining briefing of that run without calling
the LLM again. The next run tries again. Storage is idempotent: a briefing already stored at the
current prompt version is skipped without any LLM call. Two overlapping runs can both pay for the
same briefing (each makes its LLM calls); the second save is a no-op.

**Run duration.** Without the LLM a post-close run is a handful of upstream requests and database
writes; each briefing action makes up to two model requests (the first and one repair retry), and each
request can take several HTTP calls (prompt-mode repairs, a native-to-prompt retry) of up to
`LLM_TIMEOUT_MS` each, so a run with several briefings to write can take minutes. The cron route
declares `maxDuration = 300` (seconds; honoured by Vercel, ignored on a plain Node server), and a
per-run time budget (`BRIEFING_RUN_BUDGET_MS`, 270 s from the start of the run, in
`src/ingestion/briefings.ts`) stops new briefing actions from starting after it: they are reported
`skipped` with `run time budget exhausted`, and the next run picks them up. The budget is a start
gate, not a hard cap: an action already running is not interrupted, and one action can make up to
8 HTTP calls (two `generateObject` requests of up to 4 calls each) of up to `LLM_TIMEOUT_MS` each,
so a run can exceed 300 s. Where `maxDuration` is enforced such a run is cut off and the next run
retries the unfinished briefing. Give your scheduler or
proxy a request timeout of at least 300 s.

**Futures rollover.** How darkfanxing defines the 台指期近月 `change` around contract settlement
and rollover is not documented, so the weekly 台指期 change does not rely on it. It is written
only when every pair of adjacent weekdays chains (a day's close minus its change equals the
previous day's close, within half a point); a break withholds the line, and the per-day lines
stay. A week that holds a monthly settlement day (the third Wednesday) carries a note on the
line that the contract may change there. Pairs with a holiday or a missing digest between them
cannot be checked. Confirm the definition with real data around a settlement day before relying
on the weekly figure.

**Re-parse maintenance.** Before fetching, a run re-parses stored snapshots whose parse failed or
came from an older parser (action `reparse`, at most 20 rows per run, oldest first). A row that
fails again is marked in `reparse_attempted_version` and left alone until the parser version
rises. Run the cron once before relying on production data so this and the briefing backlog
catch up.

### Grounding rules

Every briefing passes deterministic checks before it is stored. What they guarantee, and what they
do not:

- The model sees only text the engine builds: the fact sheet from parsed data (sector names and
  limit-up/down lines are flattened to one line and clipped), the glossary term list and our own
  rules. Two kinds of other text also reach it, both as labelled context it is told not to copy:
  the data source's own caveats, in a delimited data block at the end of the daily user message
  (third-party text, never in the system prompt), and, for the weekly briefing only, the stored
  daily summaries of that week, as narrative. It never sees raw HTML or credentials.
- Every number in the text must come from the fact sheet, exactly or as a rounding of a fact (at
  most one decimal place dropped). A percentage must match a fact written as a percentage, and a
  number written with an explicit `+`/`-` must match a fact of the same sign. Small whole numbers
  up to 20 (ranks and counts) are always allowed. The weekly sheet's numbers come only from its
  computed lines, never from the daily summaries.
- Known limits: the check matches numbers, not subjects, so a number that happens to be another
  fact on the sheet passes even when attached to the wrong sector, and an unsigned number with
  the wrong direction word ("上漲 1.24%" for a −1.24% fact) passes. Chinese numerals are not
  checked.
- No predictions: wording about the next trading day or the future direction (明天, 隔日, 後市,
  預料…回升, …) and guarantees (保證, 穩賺) are rejected. Weekday+session wording (週一開盤) counts
  as a future-time word in daily briefings only; the weekly narrates a past week and is asked to
  name days by date instead. The data source forbids
  inferring tomorrow from its 內外盤差 figure. No advice: buy/sell and call-to-action words (買進,
  加碼, 停損, 逢低, …) and URLs, domains and e-mail addresses are rejected. The word lists live in
  one registry (`src/insight/forbidden-wording.ts`) used by both the prompts and the checks.
- A briefing that breaks a rule gets one repair retry that names the violations. If it still
  fails, it is **rejected and never stored**; the run report shows the reasons.
- Both lenses write in Taiwan Traditional Chinese; the beginner lens also explains jargon and cites
  glossary term ids. The briefing text itself may or may not contain the education disclaimer
  (the prompt asks for it, the checks do not require it): the app shows the fixed sentence
  「以上為資料整理與教育說明，不構成投資建議」 with every briefing.

### Regenerating after a prompt change

Prompts live in `src/insight/prompts/`. Briefings are keyed by period, lens and prompt version, and
a stored briefing with an equal or newer version is never replaced. To regenerate after editing a
prompt, bump `DAILY_PROMPT_VERSION` (`daily.ts`) and/or `WEEKLY_PROMPT_VERSION` (`weekly.ts`). The
next cron run writes the new daily version for the settled date and, through the catch-up window,
for up to 4 earlier dates per lens; older dates keep the version they have. A
`WEEKLY_PROMPT_VERSION` bump regenerates only the weekly of the settled date's week, and only once
that week is complete; earlier weeks keep their version. `bun run briefing:dev -- <date>`
fills any specific date by hand, and also uses the version check, so it needs the bump too.

## Planner

The planner turns a risk questionnaire and two amounts (a sum available now, a monthly amount)
into an allocation, an investing rhythm and a historical back-test, all from stored prices and
dividends. Every number is deterministic code over stored data; no LLM is involved and nothing a
user sends is stored or logged.

### Rules are data

The signed-off rules live in `src/planner/rules/`, each with unit tests, so a change is a small
reviewed diff:

| File | Holds |
| --- | --- |
| `questionnaire.ts` | The five questions, option ids and scores, `scoreProfile` (capacity, willingness, level, horizon cap, reserve-first) |
| `allocation.ts` | The allocation table per level and the emergency-reserve months per income stability |
| `rhythm.ts` | Tranche months (6 for levels 1-3, 3 for levels 4-5, none when the lump is under 3 times the monthly amount) |
| `instruments.ts` | The category members (core, bond, dividend) and the eligibility thresholds |

### How instruments are chosen

Members of each category are a list in `instruments.ts`, changed by PR; the weekly ETF listing
refresh only feeds a "please confirm" report (`bun run plan:dev -- --discover`) and never adds
anything by itself. At request time a member is **eligible** when its latest trade is at most 10
days older than the newest bar among the members (so a market-wide break such as Lunar New Year
does not make them all stale), its stored history is at least 5 years (core, dividend) or 3 years
(bond), the median daily turnover of its last 120 bars is at least 100 million TWD, its name has no
leveraged, inverse, futures, currency or commodity marker (a leading 期, 正2, 原油, 白銀, `+R`
and the like) and its symbol does not end in L, R or U (TWSE's leveraged, inverse and futures
suffixes). The same name and symbol rules keep such ETFs out of `--discover`. The **primary** of a category is the eligible
member with the longest history; the next one is the alternate. A category without an eligible
member holds its weight as cash with a warning (core without one answers 503 `data_unavailable`).

### `POST /api/plan`

A public route (no login yet, like the other read routes) that computes a plan per request. The
body is capped at 4 KB. It answers 400 `{"error":"invalid_request"}` for a bad body, 503
`{"error":"data_unavailable"}` when no core instrument has data and 500 otherwise; success is
`cache-control: no-store`.

```sh
curl -X POST http://localhost:3000/api/plan -H "content-type: application/json" -d '{
  "answers": {
    "age": "age-30-39",
    "horizon": "horizon-10y-plus",
    "income": "income-stable",
    "reserve": "reserve-3-6m",
    "loss": "loss-hold"
  },
  "lump": 600000,
  "monthly": 15000,
  "monthlyExpenses": 30000,
  "existingReserve": 90000
}'
```

Option ids are the ones in `questionnaire.ts`; amounts are whole TWD. The response is
discriminated by `kind`:

- `reserve_only`: the emergency-reserve gap is at least the lump sum, so only `profile`,
  `amounts` (reserve target, gap, months to fill it from the monthly amount) and `assumptions`
  are returned.
- `insufficient_history`: the chosen instruments share less than a year of history.
- `plan`: `profile`, `amounts` (reserve, investable money, slice amounts, `weights`, tranche months),
  `instruments` (category, symbol, name, alternate), `rhythm`, `window` (shared `from`/`to`,
  years and every symbol used in that common window, not only the one that limits it),
  `scenarios`, `equityOnly`, `warnings`, `assumptions`. `amounts.trancheMonths` is the rhythm
  rule's raw answer; `rhythm.trancheMonths` is what the `plan` scenario actually used.
  `amounts.weights` are the integer percents (sum 100) the slices were split by, after a slice with
  no eligible ETF moved to cash; every kind carries them, and with `investable` 0 (a monthly-only
  saver whose reserve is full) they are how the monthly amount is to be split.

`scenarios` holds three runs over the same window, the same weights and the same money, which
differ only in when the lump goes in: `lump` (all at the start), `dca` (spread over 12 months)
and `plan` (the rule rhythm). Each run has `from`, `to`, `invested`, `finalValue`, `xirr`
(money-weighted, includes the timing of each deposit), `cagr` (only meaningful for one day-1
contribution), `maxDrawdown`, `volatility`, `worstYear` (worst rolling 12 months) and
`valueSeries`, a month-end series for charts (illustrative values):

```json
"valueSeries": [
  { "date": "2017-01-17", "value": 65000, "invested": 65000 },
  { "date": "2017-01-24", "value": 65420, "invested": 65000 },
  { "date": "2017-02-23", "value": 80510, "invested": 80000 }
]
```

The first point is `from`, then each month's last trading day, and the last point is `to`
(its `value` is `finalValue`). `equityOnly` repeats the three runs for core and dividend alone
over their longer shared history (null when it adds nothing); it carries its own `from` and
`years`, and when it is present `assumptions` ends with 「只有股票的試算不含債券與現金」.

### Limits

- **No fees or taxes.** Returns are gross of brokerage fees, transaction tax, fund expenses
  beyond what is in the price, and income tax on dividends. Dividends are reinvested at the
  ex-date reference price.
- **Short bond history.** The bond ETFs list from 2017 at the earliest (00679B: 2017-01-17), so the
  main window starts there; the equity-only run shows the longer stock history and says it holds no bonds.
- **Satellite proxy.** The satellite slice has no single instrument; the back-test prices it
  with the core's return, so the real risk is higher. Levels 3-5 hold a satellite slice and
  their `assumptions` say so; levels 1-2 hold none and leave that line out.
- Past performance does not predict the future; the response says so in `assumptions`.

### Checking against real data

```sh
bun run plan:dev -- --discover      # stored ETFs in no category list, with a name-based guess
bun run plan:dev -- --level 3 --lump 600000 --monthly 15000 --expenses 30000 \
  --reserve 90000 --income stable   # same planPortfolio as the route
```

`--level` is reached through the questionnaire itself (a level the chosen income cannot reach is
rejected). The output shows, per category, which members were eligible and why others were not,
then the profile, amounts, instruments, window and the three scenarios. It prints no environment
values.

### Plan explanations

Each of the five risk levels has a short, AI-written explanation of its allocation in both lenses
(`beginner`, `pro`): ten stored texts. They are generated ahead of time and shared, never per
request, so nothing a user typed (answers, amounts) ever reaches the LLM. The LLM only explains
numbers the planner already computed.

**How they are generated.** Per level, `planReference` (`src/planner/plan-service.ts`) runs the
level's allocation row as one lump of money on day 1, rebalanced yearly with dividends reinvested,
over the same primaries and windows as `POST /api/plan`, and returns ratios only (no money):
`cagr`, `maxDrawdown`, `volatility`, `worstYear`, plus the equity-only run when it adds something.
`buildPlanFacts` (`src/insight/facts-plan.ts`) turns that into a fact sheet (the level, each held
slice with its integer weight and fund, the data window, the metrics as percents with exactly two
decimals, the data end date). The LLM writes the text from the fact sheet and the plan glossary
terms, the same validators as for briefings check it (with the extra rules below), and only then is
it stored per level × lens (`plan_explanations`). A rejected text gets one repair retry; if it
still fails nothing is stored. The previous text keeps serving only while the structure (weights,
funds, warnings, window start) is unchanged; a text written for another structure is removed
before the new one is generated, so the endpoint returns 404 until a new text passes the checks.

**When they refresh.** In the ingestion cron's **post-close phase only** (never in the closed-day
or pre-open runs), after the briefings, sharing the briefings' circuit breaker and time budget.
A stored explanation is skipped (no LLM call) when it already covers the current Taipei ISO week,
the prompt version (`PLAN_PROMPT_VERSION` in `src/insight/prompts/plan.ts`) and the **facts
fingerprint**: a hash of the structure (level, weights, funds with symbols, warnings, the start
dates of the runs). New trading days change the metric figures but not the fingerprint, so the
text refreshes about once a week; a fund switch or a slice that starts being held as cash changes
the fingerprint and regenerates it within the week; the old text is deleted first (a warning is
logged), so a rejected regeneration leaves no text rather than one describing an allocation that
no longer exists. A higher prompt version always replaces and is never deleted by a lower one; the
fingerprint never leaves the server.

```sh
curl "http://localhost:3000/api/plan/explanation?level=3&lens=beginner"
```

`level` is a single digit 1-5 (required); `lens` is `beginner` (default) or `pro`. 400
`{"error":"invalid level"}` or `{"error":"invalid lens"}` for bad input, 404 `{"error":"not_found"}`
when nothing is stored yet, `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`.
The response carries the stored text with the glossary entries it cites (ids the glossary lacks are
dropped), without the fingerprint (illustrative values; each `terms` entry is the glossary
endpoint's term object):

```json
{
  "explanation": {
    "level": 3,
    "lens": "beginner",
    "periodKey": "2026-W42",
    "promptVersion": 1,
    "model": "your-model",
    "content": {
      "headline": "...",
      "summary": "...",
      "sections": [{ "title": "用白話看這個配置", "body": "..." }, { "title": "...", "body": "..." }],
      "takeaway": "...",
      "termIds": ["max-drawdown", "rebalance"]
    },
    "createdAt": "2026-10-15T08:30:00.000Z"
  },
  "terms": { "max-drawdown": { "id": "max-drawdown", "term": "最大回撤", "...": "..." } }
}
```

**Rules the text is held to.** The checks are those of the [grounding rules](#grounding-rules),
and stricter in two places: every number must come from the fact sheet (the only figures are the
level's weights and the historical run's ratios), with no new sums, differences or multiples;
no predictions (future-time and direction words, and weekday+session wording, are rejected); no
advice. On top of the shared word lists, a plan-only list is rejected as advice or reassurance:
適合, 合適, 安心, 放心, 建議配置, 可以考慮, 不用擔心, 勝過, 優於, 保本, 零風險, 安全, 穩定,
低風險, 風險低, 風險較低, 抗跌, 避險 (`PLAN_EXTRA_ADVICE_WORDS`; 定存 is deliberately absent, as it
would also match 「固定存入」). The prompt also forbids judging who a mix suits, reassuring the
reader, judging which level is more or less risky, comparing it with other products, and reading 年化報酬率 as a yearly result (it is
an average over the whole period). Known limits, as for briefings: the checks match numbers, not
subjects, so a label attached to the wrong figure cannot be caught, and the reference run is a
single historical path (levels with a long-duration bond fund can show deep drawdowns). Each
level's window starts where its funds' common history starts: on current data level 5 (no bond)
starts in 2007 and levels 1-4 in 2017, so annualized returns and drawdowns are not comparable
across levels. The screen must show each level's window next to its figures and never rank levels
by these figures.

**What the screen must add itself.** The stored text does not carry these, and the screen has
to show them next to it:

- the two fixed sentences 「過去表現不代表未來」 and 「以上為資料整理與教育說明，不構成投資建議」
  (the model may also write the latter, but the screen never relies on it);
- the user's own figures (amounts, reserve, scenarios), which come from `POST /api/plan` and are
  never part of the explanation;
- for levels 3-5, the satellite note 「衛星部位以核心報酬代替，實際風險更高」 (the explanation
  states the satellite weight neutrally and makes no risk claim; the proxy's risk note comes from
  the plan response's `assumptions`).

The live LLM check is still outstanding, as for briefings: the validators and prompts are tested
against scripted fakes and the real fact sheets, but no real endpoint has written a plan
explanation yet. Run the first generation by hand and read the output before relying on it.

### First run and data volume

Prices start from 2003-01-01 (0050 lists in mid-2003) for all 21 category members. A first or
gap backfill costs 3 FinMind requests per symbol and a run starts at most 3 of them
(`MAX_SYMBOL_BACKFILLS_PER_RUN`), so a fresh database needs about 7 post-close cron runs before
every member has history; until then a missing category falls back to the warnings above or to
503. Topping a symbol up also costs 3 requests (1 for prices, 2 for corporate actions), so a full
refresh of the 21 symbols is 63-73 requests (with backfills and the weekly listing), about 6-7
minutes at the shared limit of 10 requests a minute: longer than one run's 300 s. A run therefore
stops starting new symbols 150 s after it started (`PRICE_RUN_BUDGET_MS` in
`src/ingestion/run-ingestion.ts`; the rest are reported `skipped` with `price budget exhausted`)
and works stalest first, so the 14:05, 14:20 and 14:35 runs share the refresh and no symbol
starves; the briefings run after the prices within the same run. A symbol already up to date costs
no request. Give the scheduler's request a timeout of at least 300 s (the same advice as for
briefings).

## Ask backend

`POST /api/ask` ("問問看") streams an AI analyst's answer: a conclusion first, then the evidence,
up/flat/down scenarios, what it means for the person, a recommendation and a confidence level. It
may use built-in read-only data tools, the playbooks in `src/ask/skills/`, and external tools you
connect over MCP. Daily and weekly briefings and plan explanations stay facts-only and are not
affected. This is the backend (phase 4A); the chat screen comes in 4B.

The AI's view is an opinion, not a guarantee and not investment advice. The server stores nothing
of any conversation or profile (they live on the device and ride in each request); it keeps only,
per invite-code identity and day, a message count and token totals.

### Configuration

All optional except `AUTH_SECRET` and `INVITE_CODES`. Values below are placeholders (see
`.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `INVITE_CODES` | required | Comma-separated invite codes. Use at least 16 random characters each |
| `AUTH_SECRET` | required | Signs the session cookie, at least 32 random characters, different from `CRON_SECRET` |
| `ASK_VOICE` | `analyst` | `analyst` (opinions, forecasts, recommendations) or `facts_only` (facts, no forecasts, no advice) |
| `ASK_TOOLS` | `on` | `on` or `off`; set from `bun run ask:probe`. `off` answers from built-in data and the request context only, with a notice |
| `ASK_MCP_SERVERS` | `[]` | JSON array of external MCP servers, see below |
| `ASK_DAILY_MESSAGE_LIMIT` | `30` | Messages per invite code per Taipei day |
| `ASK_MAX_STEPS` | `6` | Model/tool steps per answer |
| `ASK_TOOL_TIMEOUT_MS` | `20000` | Per tool call |
| `ASK_MAX_OUTPUT_TOKENS` | `2500` | Output cap per answer |

The model comes from the same `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` as the briefings, and
`LLM_TIMEOUT_MS` is the deadline of a whole answer. The endpoint must support streaming; tool
calling is optional (see `ASK_TOOLS` and the probe below).

### Invite flow

Only `POST /api/ask` is protected; the read-only endpoints above stay open.

```sh
# Exchange an invite code for a session cookie (204 and Set-Cookie; 401 for a wrong code)
curl -i -X POST http://localhost:3000/api/auth/invite \
  -H 'content-type: application/json' -d '{"code":"<one of INVITE_CODES>"}' -c cookies.txt

curl -b cookies.txt http://localhost:3000/api/auth/session            # 200 {"ok":true} or 401
curl -b cookies.txt -X DELETE http://localhost:3000/api/auth/session  # sign out (204)
```

The cookie `muggle_session` is signed with `AUTH_SECRET`, `HttpOnly`, `SameSite=Lax`, `Secure` on
HTTPS, and valid for 30 days. It carries a hash of the code's identity, not the code. After 5
wrong codes in 10 minutes an address gets 429 until the window ends. The throttle is in memory,
per process, and keys on `x-real-ip`, else the last `x-forwarded-for` hop: it is only meaningful
behind a proxy that overwrites one of those headers. Without one, the headers can be spoofed, so
rely on long random codes, not on the throttle.

### `POST /api/ask`

```sh
curl -N -b cookies.txt -X POST http://localhost:3000/api/ask -H 'content-type: application/json' -d '{
  "lens": "beginner",
  "messages": [{ "role": "user", "content": "市場在跌，我要不要調整手上的投資？" }],
  "profile": {
    "plan": { "answers": { "age": "age-30-39", "horizon": "horizon-5-10y", "income": "income-stable",
                           "reserve": "reserve-3-6m", "loss": "loss-hold" },
              "lump": 600000, "monthly": 15000, "monthlyExpenses": 30000, "existingReserve": 90000 },
    "holdings": [{ "symbol": "0050", "amount": 300000, "quantity": 2000 }],
    "memory": ["兩年內想買房"]
  }
}'
```

Request: `lens` is `beginner` or `pro`. `messages` holds 1 to 20 entries of `{ role: "user" |
"assistant", content }` (1 to 4000 characters each); the last one must be from the user. `profile`
is optional: `plan` (the same body as `POST /api/plan`), up to 30 `holdings` (`symbol`, optional
`amount` and `quantity`) and up to 20 `memory` notes of 200 characters. The whole body is capped
at 64 KiB (413 `too_large`). CJK text is 3 bytes per character, so a long conversation reaches the
byte cap before the 20-message cap: the client must trim the oldest messages by size.

Response: a `text/event-stream` in the AI SDK UI message stream format (`useChat` reads it
directly), with `cache-control: no-store`, ending with `data: [DONE]`. Besides the standard parts
(`start`, `text-*`, `tool-*`, `finish`) it carries two data parts:

- `data-notice`, sent first: `{ "kind": "no_web" | "no_tools" | "tool_failed" | "timeout", "text": string }`.
  `no_web`: no external tools this turn ("這次沒有查網路"); `no_tools`: the endpoint rejected tool
  calls, so nothing was used; `tool_failed`: some MCP servers could not be reached (names in the
  text); `timeout`: the answer hit `LLM_TIMEOUT_MS` and stops where it got to.
- `data-verification`, sent last: `{ "unsupported": string[], "checked": boolean }`. The numbers
  in the answer that match no tool result, profile value or number the user wrote, as they appear
  in the text. A soft hint, not a block. `checked: false` means the check itself failed, so an empty
  list then says nothing.

Errors are JSON `{ "error": code }`: 401 `unauthorized`, 400 `invalid_request`, 413 `too_large`,
429 `rate_limited` (with `retry-after` to Taipei midnight, `x-ask-limit` and `x-ask-used`), 503
`llm_unavailable` (the model could not start an answer) and 500 `internal_error`.

**Quota.** `ASK_DAILY_MESSAGE_LIMIT` messages per invite code per Taipei day. A message is spent
when the request passes validation, even if the model then fails with 503. Tokens are recorded
per code and day but not limited.

### Built-in tools, skills and voices

The model can call read-only tools that read the database only (never an upstream): today's
market and temperature (`getMarketToday`), the sector board and details (`getSectorBoard`), the
glossary (`lookupTerm`), price history and returns of an instrument (`getInstrumentHistory`), the
deterministic result of the person's plan (`getMyPlan`, computed by the planner, never by the
model) and the latest daily or weekly briefing (`getLatestBriefing`).

Skills are Traditional Chinese playbooks, one Markdown file each in `src/ask/skills/*.md` with
`name` and `description` front matter. The system prompt lists them and the model loads one on
demand with `loadSkill`. Adding a method means adding a file.

`ASK_VOICE=facts_only` switches to a prompt without forecasts or recommendations, the fallback if
the `analyst` voice does not pass review before going public. Prompts are versioned
(`ASK_PROMPT_VERSION` in `src/ask/prompts/ask.ts`).

### External tools over MCP

`ASK_MCP_SERVERS` is a JSON array. The project is not tied to any vendor: bring your own search
(or other) MCP server and its key.

```sh
ASK_MCP_SERVERS='[{"name":"search","url":"https://mcp.example.com/mcp","transport":"http","headerEnv":{"Authorization":"SEARCH_MCP_AUTH"},"allow":["web_search"]}]'
SEARCH_MCP_AUTH='Bearer <your key>'
```

- `name`: lowercase letters, digits and `_` (no `__`), unique; the model sees tools as `name__tool`.
- `transport`: `http` (default) or `sse`.
- `headerEnv`: request header name to the NAME of an environment variable holding its value. Header
  values never go in the JSON and are never logged.
- `allow`: the only tool names exposed from that server; everything else is dropped.

Results are size-capped and marked untrusted: the model may cite them, not obey them. Every call has
`ASK_TOOL_TIMEOUT_MS`. If a server cannot be reached the answer continues without it (notice
`tool_failed`); if the endpoint rejects tools altogether, the answer is retried without any and a
`no_tools` notice is sent.

### Privacy and its limits

- Holding amounts and quantities are private. The prompt says so, and before any external tool call
  the server refuses arguments that contain a private amount (the plan's amounts and each holding's
  amount and quantity, when 1000 or more), in plain digits, thousands separators, 萬/億,
  `1.5M`, Chinese numerals and similar. The model is told and can retry without the amount.
  Symbols and years are not blocked: a holding's symbol may appear in a web search ("0050 news"),
  and the chat screen will say so.
- This filter is best-effort, not a guarantee. Known gaps include amounts spelled out in English
  ("one point five million"), exotic encodings, lakh/crore, and a number split across arguments.
  Numbers written inside remembered notes (`memory`) are shown to the model, which is told not to
  put them in external queries, but they are not part of the server-side filter.
- The verification of numbers is also best-effort: it can miss a wrong number and flag a right one.
- The server stores no conversation, profile or memory. Logs carry counts, ids and error codes
  only (steps, tool-call count, token totals, HTTP status); never message text, profile values,
  tool arguments or results, URLs or header values.

### Checking the endpoint and the answers

Neither command runs in tests or CI; both use the real `.env`.

```sh
bun run ask:probe     # what the LLM endpoint supports
bun run ask:eval      # run the question set, write ask-eval-<date>.md
```

`ask:probe` sends a tiny streamed completion and one with a trivial tool, then prints for each
`ok` or `fail` with the HTTP status class only (`2xx`, `4xx`, `5xx`, `network`) and the suggested
`ASK_TOOLS` value. It prints no URL, header, key or body. Run it first and set `ASK_TOOLS`.

`ask:eval` runs about 20 fixed questions (the four from the design in both lenses, plus sector,
ETF, plan, stock forecast, holdings news and dividend questions) through the same code as the
route, against the real database and endpoint, with a sample profile (one plan, two holdings) and
no session or quota. Options: `--lens beginner|pro`, `--id <question id>` (for example
`market-down-beginner`), `--limit N`. It writes `./ask-eval-<date>.md` (git-ignored): per question the
answer, the tool names, the notices, the unsupported numbers and an unticked rubric checklist to
fill in by hand (conclusion first, sources, scenarios and confidence, no invented numbers, no
private data in tools, depth for the lens). It spends real tokens.

## UI

The app is a small installable PWA in Traditional Chinese. It only reads the same-origin `/api/*`
GET endpoints above; it never calls an LLM itself, and every AI-written line it shows comes from
a stored briefing. Every figure carries its data date, and up/down figures use the Taiwan
convention (red up, green down) together with a `+`/`-` sign.

### Screens

| Path | Screen |
| --- | --- |
| `/` 今日 | The latest closed trading day. The **今天** tab shows the daily briefing's headline and text for the current mode, the up/down sector bar, key figures and term chips. A **離開期間** tab appears when more than one trading day passed since the last visit: the futures change over the gap, the strong-sector count then and now, and one stored line per day. Beside it, the leading/lagging sectors and the biggest money flows. Ends with 「以上為資料整理與教育說明，不構成投資建議。」 |
| `/sectors` 族群 | Three views of the sector board: change (searchable, sortable list on a phone, table on desktop), net active buying (top 10 in and out) and flow quadrants. Selecting a sector shows its stocks, as a page on a phone and in a side pane on desktop; the selection lives in `?group=`. |
| `/plan` 規劃 | The planner: a short questionnaire, then how to split the money, how to put it in, and what that would have done in the past. See Planner screen below. |
| `/glossary` 名詞 | Searchable glossary by category. A term opens a panel (bottom sheet on a phone, side sheet on desktop) with related terms. Term chips on other screens open the same panel. |
| `/settings` 設定 | Reading mode and appearance. |

Phones get a bottom tab bar (今日, 族群, 規劃, 名詞) plus a gear for Settings; from 768 px wide a sidebar replaces both.

### Mode and theme

Reading mode (入門 beginner / 專業 pro) and appearance (跟隨系統, 淺色, 深色) are set only in
Settings and stored on the device (`localStorage`, key `muggle.settings.v1`). The mode picks
which briefing lens, glossary wording and sector copy are shown; there is no switch on the
other screens. The device also remembers the last trade date it showed (`muggle.lastSeen.v1`),
which drives the 離開期間 tab.

### Offline

The service worker caches the five screens' HTML and the app's static assets, never API
responses. The app keeps the last good response of each data endpoint in `localStorage`. Offline,
or when a refresh fails, the screens show that data with its own data date and the banner
「目前離線，顯示的是上次載入的資料。」 (or a stale notice naming the date). Data never loaded
online, such as a sector never opened, is not available offline.

### Planner screen

Route `/plan` (規劃, between 族群 and 名詞). The server renders the screen with the empty form
and hydrates it; the answers are read on the device after load, and the result comes from
`POST /api/plan`.

**Flow.** Five questions (age, time horizon, income, months of reserve, reaction to a 20% loss),
then four amounts (a sum available now, a monthly amount, monthly living costs, the emergency
reserve already held). On a phone it is one question per page with progress dots; picking an
option with a tap moves on, while keyboard users choose with the arrow keys or Space and press
下一步. From 768 px wide all nine inputs are on one page. The risk level is never shown while
answering. 看我的規劃 sends the answers and shows the result; 修改答案 goes back to question 1.

**Result.** Top to bottom on a phone: risk level (a five-step meter, how ability and willingness
gave the level, a note when the time horizon capped it), emergency reserve and notices, the
allocation (a stacked bar and the amount, share and instrument of each slice), the investing
rhythm, the history, the stored AI explanation, the assumptions the server listed, and the two
fixed sentences. From 1024 px wide it is two columns: reserve, allocation, rhythm and history on
the left; level, explanation and assumptions on the right. Both columns scroll with the page. When
there is nothing to invest now (no lump and the reserve already full) but a monthly amount, the
allocation is titled 每月 X 元怎麼分 and splits the monthly amount by the same weights; the history
card then lists one run (每月投入) instead of three identical ones.
A plan whose emergency reserve is not full shows only the reserve plan; with under a year of
history it shows only the allocation and rhythm. The AI explanation appears only with a full plan
(it explains a level's history): for those two shorter results it is neither shown nor requested.

**What stays on the device and what is sent.** The answers and the typed amounts are kept in
`localStorage` under `muggle.plan.draft.v1`, read field by field (a bad value only drops that
field). Results are never stored. Each time the result opens (including every visit to `/plan` with a
complete draft) the answers and amounts are sent once to `POST /api/plan`, which computes the plan
and stores nothing. The AI explanation is requested
with only the level and the reading mode (`GET /api/plan/explanation`), so no amount of yours
reaches the language model or the explanation route. 清除我的答案 (shown whenever something is
saved, on the form and on the result) deletes the saved draft from the device and returns to an empty
questionnaire, for a shared phone or computer.

**Fixed sentences.** 「過去表現不代表未來。」 and 「以上為資料整理與教育說明，不構成投資建議。」 are
printed on every result and every history view prints its own window (from, to, years). Returns
of different levels are never shown side by side. The longer 「只有股票」 history (from 2007) is
a tab on the history card with its own window and a note that it holds no bonds or cash; it is
not the recommended allocation's result.

**Reading mode.** Beginner and pro differ only in wording (for example 最深曾經跌 versus 最大回撤,
換算成每年 versus XIRR); the numbers are the same.

**Offline.** `/plan` is precached with the other screens, so the questionnaire opens offline and
the answers are kept. `POST /api/plan` is never cached: offline the result says 需要連線才能試算.

**The chart.** Recharts (through shadcn's chart) is about 370 kB raw (107 kB gzip). It is loaded
as its own chunk when the result opens (`React.lazy`, started when the result mounts, in
parallel with the request), so the questionnaire does not carry it. If the chunk fails to load,
the history card says 歷史暫時讀不到 and the rest of the result stays. The chart is a picture
of the table beside it: hidden from assistive technology, nothing focusable inside; the table
(with a caption naming its window) holds the same numbers.

**Draft wording.** All of the screen's strings are in `src/ui/plan/copy.ts`, marked as draft
wording awaiting the owner's review (the same arrangement as `src/ui/sectors/copy.ts`). Change
the strings there, not in the components. Option labels come from `src/planner/rules/questionnaire.ts`.

**The explanation before the first generation.** `GET /api/plan/explanation` answers 404 until
the first real LLM generation has stored one for that level and mode; the screen then shows
「說明還在準備中」 as a quiet line, not an error. For local work, `bun run briefing:sample`
stores sample explanations (see below).

### Sample briefings for local work (dev only)

To see the briefing layout without an LLM endpoint, after the ingestion job has stored at least
one closed digest:

```sh
bun run briefing:sample
```

This stores one sample daily briefing per lens for the latest stored digest date, and the ten
sample plan explanations (five levels × two lenses) for the current ISO week (Taipei). Every text
field starts with 【範例】, the model is recorded as `sample`, and the text quotes no market
figures; a sample plan explanation quotes only its level's allocation percentages. Samples are
stored at prompt version 0, so they never replace a real briefing or plan explanation, and the
next real generation replaces them. The script is safe to repeat. **Never run it against a production
database:** the script refuses to start when `NODE_ENV=production`, but that guard only works if
the variable is set. To remove samples by hand: `delete from briefings where model = 'sample'; delete from plan_explanations where model = 'sample';`.
