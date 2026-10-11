/**
 * Measures the darkfanxing rate-limit window.
 *
 * Usage: bun --env-file=.env scripts/probe-ratelimit.ts
 *
 * Sends up to BURST_REQUESTS rapid requests to /api/now/{key}, logging status and
 * x-ratelimit-* headers, then polls every POLL_INTERVAL_MS until `remaining` recovers
 * (or POLL_CAP_MS elapses). The key is never printed: logs show the path as /api/now/***.
 */
const BASE_URL = "https://stocks.darkfanxing.com";
const BURST_REQUESTS = 11;
const POLL_INTERVAL_MS = 10_000;
const POLL_CAP_MS = 10 * 60_000;

const key = process.env.DARKFANXING_KEY;
if (!key) {
  console.error("DARKFANXING_KEY is not set");
  process.exit(1);
}

type Sample = { at: Date; status: number; limit: string; remaining: string; reset: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(label: string): Promise<Sample> {
  const response = await fetch(`${BASE_URL}/api/now/${encodeURIComponent(key ?? "")}`);
  await response.arrayBuffer();
  const header = (name: string) => response.headers.get(name) ?? "-";
  const sample: Sample = {
    at: new Date(),
    status: response.status,
    limit: header("x-ratelimit-limit"),
    remaining: header("x-ratelimit-remaining"),
    reset: header("x-ratelimit-reset"),
  };
  const extra = sample.status === 429 ? ` retry-after=${header("retry-after")}` : "";
  console.log(
    `${sample.at.toISOString()} ${label} GET /api/now/*** status=${sample.status} limit=${sample.limit} remaining=${sample.remaining} reset=${sample.reset}${extra}`,
  );
  return sample;
}

const burst: Sample[] = [];
for (let i = 1; i <= BURST_REQUESTS; i++) burst.push(await probe(`burst#${i}`));

const first = burst[0];
const lowest = Math.min(...burst.map((s) => Number(s.remaining)).filter(Number.isFinite));
const start = Date.now();
let recovered: Sample | undefined;
while (Date.now() - start < POLL_CAP_MS) {
  await sleep(POLL_INTERVAL_MS);
  const sample = await probe("poll");
  if (sample.status !== 429 && Number(sample.remaining) > lowest) {
    recovered = sample;
    break;
  }
}

if (first && recovered) {
  const seconds = Math.round((recovered.at.getTime() - first.at.getTime()) / 1000);
  console.log(
    `recovered: remaining went ${lowest} -> ${recovered.remaining}; ~${seconds}s after first request`,
  );
} else {
  console.log(`not recovered within ${POLL_CAP_MS / 60_000} minutes`);
}
