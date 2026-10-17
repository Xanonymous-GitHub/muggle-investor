/**
 * Checks what the configured LLM endpoint supports for Ask: a tiny streamed completion, then a
 * completion that offers one trivial tool. Run it once against the real endpoint, then set
 * `ASK_TOOLS` as suggested.
 *
 * Usage: bun run ask:probe
 *
 * Prints `streaming: ok|fail (<class>)`, `tools: ok|fail (<class>)` and the suggested `ASK_TOOLS`
 * value, where <class> is 2xx, 4xx, 5xx, network (no response) or other. It never prints a URL,
 * header, key, response body or error message. The tools check passes when the endpoint accepts
 * the request with a tool definition; it does not require the model to call the tool. When it
 * fails, `ASK_TOOLS=off` makes Ask send no tool definitions at all (no data tools, no web search),
 * so an endpoint without tool support still answers. Exits 1 on
 * an invalid environment, 0 otherwise (a failing endpoint is a result, not a crash).
 */
import { streamText, tool } from "ai";
import { z } from "zod";
import { classifyFailure, formatProbe, type ProbeStep } from "@/ask/eval/probe";
import { getEnv } from "@/config/env";
import { createChatModelFromEnv } from "@/insight/llm";
import { describeFailure } from "@/server/describe-failure";

const PROBE_TIMEOUT_MS = 30_000;

type Model = ReturnType<typeof createChatModelFromEnv>;

/** One call, read to the end. A failure is reduced to its status class at once. */
async function attempt(model: Model, withTool: boolean): Promise<ProbeStep> {
  try {
    const result = streamText({
      model,
      prompt: withTool ? "Call the ping tool once, then say done." : "Reply with the word ok.",
      ...(withTool && {
        tools: {
          ping: tool({
            description: "Returns pong.",
            inputSchema: z.object({}),
            execute: async () => ({ pong: true }),
          }),
        },
      }),
      maxOutputTokens: 32,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      // The default handler would print the error, request body included.
      onError: () => {},
    });
    for await (const part of result.fullStream) {
      if (part.type === "error") return { ok: false, statusClass: classifyFailure(part.error) };
    }
    return { ok: true, statusClass: "2xx" };
  } catch (error) {
    return { ok: false, statusClass: classifyFailure(error) };
  }
}

async function run(): Promise<number> {
  const model = createChatModelFromEnv(getEnv());
  const streaming = await attempt(model, false);
  const tools = await attempt(model, true);
  for (const line of formatProbe({ streaming, tools })) console.log(line);
  return 0;
}

const exitCode = await run().catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);
