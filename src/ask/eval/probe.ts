// Pure parts of `bun run ask:probe`: how a failure is reduced to an HTTP status class and how the
// result is printed. Nothing here can carry a URL, header, key, body or error message.
import { APICallError, RetryError } from "ai";

export type StatusClass = "2xx" | "4xx" | "5xx" | "network" | "other";
export type ProbeStep = { ok: boolean; statusClass: StatusClass };
/**
 * `roundTrip`: the tool call → result → answer cycle. `called: false` means the model never called
 * the tool, so the cycle was not exercised (inconclusive, not a failure of the endpoint).
 */
export type ProbeResult = {
  streaming: ProbeStep;
  tools: ProbeStep;
  roundTrip: ProbeStep & { called: boolean };
};

/** The HTTP status class of a failed call, or `network` when no response came back. */
export function classifyFailure(error: unknown): StatusClass {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause) || cause.statusCode === undefined) return "network";
  const status = cause.statusCode;
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

/** `ASK_TOOLS` value for the result: tools are only worth turning on when both checks pass. */
export function suggestAskTools(result: { streaming: boolean; tools: boolean }): "on" | "off" {
  return result.streaming && result.tools ? "on" : "off";
}

export function formatProbe(result: ProbeResult): string[] {
  const line = (name: string, step: ProbeStep) =>
    `${name}: ${step.ok ? "ok" : "fail"} (${step.statusClass})`;
  const { roundTrip } = result;
  const lines = [line("streaming", result.streaming), line("tools", result.tools)];
  lines.push(
    result.tools.ok && !roundTrip.called
      ? "round trip: skipped (the model did not call the test tool; run again or try another prompt)"
      : line("round trip", roundTrip),
  );
  if (!result.streaming.ok) {
    lines.push(
      "the endpoint did not stream a completion; check LLM_BASE_URL, LLM_API_KEY and LLM_MODEL",
    );
  }
  if (result.streaming.ok && !result.tools.ok) {
    lines.push(
      "the endpoint did not take tool definitions; ASK_TOOLS=off sends no tools at all (no data tools, no web search)",
    );
  }
  if (result.tools.ok && roundTrip.called && !roundTrip.ok) {
    lines.push(
      "the endpoint takes tool calls but did not accept their results or end in an answer; Ask then answers from the results as text, which costs one more request",
    );
  }
  lines.push(
    `suggested ASK_TOOLS=${suggestAskTools({ streaming: result.streaming.ok, tools: result.tools.ok })}`,
  );
  return lines;
}
