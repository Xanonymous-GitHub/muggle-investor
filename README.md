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
(for the rest of the process) the first time the endpoint answers 400 or 422 to it. Set `prompt`
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
`rejected` with the reasons), the headline and the token usage. It never prints prompts, replies
or keys, and exits non-zero only if every lens failed.

### Endpoints

All endpoints are `GET` and return JSON. They are **public read routes with no authentication yet**;
access control (invite codes) comes in a later phase. Errors look like `{"error":"not_found"}` with
status 400 (bad input), 404 (nothing stored) or 500.

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
entry per trading day (with that day's one-line summary when a briefing exists) and the weekly
briefings that cover whole weeks. Briefing and glossary routes send `cache-control` headers
(briefings: `public, s-maxage=300, stale-while-revalidate=600`; glossary: `public, max-age=3600`)
and an `x-data-trade-date` header with the data date.

### How briefings are generated

The ingestion cron (`POST /api/cron/ingest`, see [Ingestion](#ingestion)) generates briefings in
every run after the market has closed, as its last step, after the prices. The LLM is therefore
never on the path of price ingestion, and a slow endpoint cannot delay it. In order:

1. The daily briefing for the settled trade date, for each lens.
2. Catch-up: per lens, up to 4 earlier closed digests from the previous 14 days that have no daily
   briefing yet (oldest first), so a few missed runs heal themselves.
3. The weekly briefing for each lens, once the week's last trading day has its daily briefing
   (a week with a holiday ends on its last open day).

Each briefing is its own action in the run report, so one failure never stops the others. A
per-run circuit breaker protects the run from a dead endpoint: the first LLM call that throws
(timeout, HTTP error, unusable output) skips every remaining briefing of that run without calling
the LLM again. The next run tries again. Storage is idempotent: a briefing already stored at the
current prompt version is skipped without any LLM call.

**Re-parse maintenance.** Before fetching, a run re-parses stored snapshots whose parse failed or
came from an older parser (action `reparse`, at most 20 rows per run, oldest first). A row that
fails again is marked in `reparse_attempted_version` and left alone until the parser version
rises. Run the cron once before relying on production data so this and the briefing backlog
catch up.

### Grounding rules

Briefings are built to be safe to read without checking them:

- The model sees only a fact sheet built from parsed data and the glossary term list, never raw
  HTML or credentials.
- Every number in the text must come from the fact sheet, exactly or as a rounding of a fact.
  Small whole numbers up to 20 (ranks and counts) are always allowed.
- No predictions: nothing about tomorrow's or future direction, and no guarantees. The data source
  forbids inferring tomorrow from its 內外盤差 figure.
- A briefing that breaks a rule gets one repair retry that names the violations. If it still
  fails, it is **rejected and never stored**; the run report shows the reasons.
- The beginner lens writes in Taiwan Traditional Chinese, explains jargon and cites glossary term
  ids; briefings are education, not investment advice, and say so once.

### Regenerating after a prompt change

Prompts live in `src/insight/prompts/`. Briefings are keyed by period, lens and prompt version, and
a stored briefing with an equal or newer version is never replaced. To regenerate after editing a
prompt, bump `DAILY_PROMPT_VERSION` (`daily.ts`) and/or `WEEKLY_PROMPT_VERSION` (`weekly.ts`). The
next cron run writes the new version for the settled date and, through the catch-up window, for up
to 4 earlier dates per lens; older dates keep the version they have. `bun run briefing:dev -- <date>`
fills any specific date by hand, and also uses the version check, so it needs the bump too.
