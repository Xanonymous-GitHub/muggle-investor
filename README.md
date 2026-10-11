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
