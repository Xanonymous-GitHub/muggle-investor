/**
 * Checks what the configured LLM endpoint supports for Ask, in three small calls: a streamed
 * completion; a completion that offers one trivial tool; and the full cycle Ask depends on (the
 * model calls the tool, the tool runs here, the result goes back, the model answers). Run it once
 * against the real endpoint, then set `ASK_TOOLS` as suggested.
 *
 * Usage: bun run ask:probe
 *
 * Prints `streaming`, `tools` and `round trip` as `ok|fail (<class>)` and the suggested `ASK_TOOLS`
 * value, where <class> is 2xx, 4xx, 5xx, network (no response) or other. It never prints a URL,
 * header, key, response body or error message. `tools` passes when the endpoint accepts a request
 * with a tool definition. `round trip` fails when the endpoint takes the call but not its result
 * back (some gateways only continue through a response id), or the continuation ends without an
 * answer; Ask then answers from the results as text. A model that does not call the test tool
 * leaves `round trip` as skipped. When `tools` fails, `ASK_TOOLS=off` makes Ask send no tool
 * definitions at all (no data tools, no web search). Exits 1 on an invalid environment, 0
 * otherwise (a failing endpoint is a result, not a crash).
 */
import { formatProbe } from "@/ask/eval/probe";
import { runProbe } from "@/ask/eval/probe-run";
import { getEnv } from "@/config/env";
import { createModelFromEnv } from "@/insight/llm";
import { describeFailure } from "@/server/describe-failure";

async function run(): Promise<number> {
  const model = createModelFromEnv(getEnv());
  for (const line of formatProbe(await runProbe(model))) console.log(line);
  return 0;
}

const exitCode = await run().catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);
