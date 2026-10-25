// The model-driving part of `bun run ask:probe`: three small calls against the configured endpoint.
// Like probe.ts it reduces every failure to a status class at once, so nothing it returns can carry a
// URL, header, key, body or error message.
import { type FinishReason, isStepCount, type LanguageModel, streamText, tool } from "ai";
import { z } from "zod";
import { chainToPreviousResponse } from "@/insight/responses-chain";
import { classifyFailure, type ProbeResult, type ProbeStep } from "./probe";

export const PROBE_TIMEOUT_MS = 30_000;

const PING_PROMPT = "Call the ping tool once, then reply with the word done.";

/** One call, read to the end. A failure is reduced to its status class at once. */
async function plain(model: LanguageModel, timeoutMs: number): Promise<ProbeStep> {
  try {
    const result = streamText({
      model,
      prompt: "Reply with the word ok.",
      maxOutputTokens: 32,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
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

/**
 * The full tool cycle Ask depends on, in one run: the model is offered a tool, calls it, the tool
 * runs here, the result is sent back, and the model must answer with text. `tools` passes when the
 * endpoint took the definition and the first request went through; `roundTrip` says whether the
 * request that carried the result back was accepted and ended in an answer. A model that never
 * calls the tool leaves `roundTrip` as `called: false`: nothing was learned about continuation.
 */
async function cycle(
  model: LanguageModel,
  timeoutMs: number,
): Promise<{ tools: ProbeStep; roundTrip: ProbeStep & { called: boolean } }> {
  let executed = 0;
  let calls = 0;
  let answered = false;
  let finish: FinishReason | undefined;
  let failure: ProbeStep | undefined;
  try {
    const result = streamText({
      model,
      prompt: PING_PROMPT,
      tools: {
        ping: tool({
          description: "Returns pong.",
          inputSchema: z.object({}),
          execute: async () => {
            executed += 1;
            return { pong: true };
          },
        }),
      },
      stopWhen: isStepCount(3),
      prepareStep: chainToPreviousResponse,
      maxOutputTokens: 64,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
      onError: () => {},
    });
    for await (const part of result.fullStream) {
      if (part.type === "error") {
        failure = { ok: false, statusClass: classifyFailure(part.error) };
        break;
      }
      if (part.type === "tool-call") calls += 1;
      // Text that comes after the tool ran is the answer to the returned result.
      if (part.type === "text-delta" && executed > 0 && part.text.trim() !== "") answered = true;
      if (part.type === "finish") finish = part.finishReason;
    }
  } catch (error) {
    failure = { ok: false, statusClass: classifyFailure(error) };
  }

  // A failure before any tool call is a rejected tool definition; after one, a rejected continuation.
  if (failure && calls === 0) {
    return {
      tools: failure,
      roundTrip: { ok: false, statusClass: failure.statusClass, called: false },
    };
  }
  const tools: ProbeStep = { ok: true, statusClass: "2xx" };
  if (calls === 0) {
    return { tools, roundTrip: { ok: false, statusClass: "2xx", called: false } };
  }
  if (failure) return { tools, roundTrip: { ...failure, called: true } };
  const ok = executed > 0 && answered && finish !== "tool-calls" && finish !== "error";
  return { tools, roundTrip: { ok, statusClass: "2xx", called: true } };
}

/** Streaming, tool definitions, and the tool call → result → answer cycle, against `model`. */
export async function runProbe(
  model: LanguageModel,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const streaming = await plain(model, timeoutMs);
  const { tools, roundTrip } = await cycle(model, timeoutMs);
  return { streaming, tools, roundTrip };
}
