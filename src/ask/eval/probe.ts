// Pure parts of `bun run ask:probe`: how a failure is reduced to an HTTP status class and how the
// result is printed. Nothing here can carry a URL, header, key, body or error message.
import { APICallError, RetryError } from "ai";

export type StatusClass = "2xx" | "4xx" | "5xx" | "network" | "other";
export type ProbeStep = { ok: boolean; statusClass: StatusClass };
export type ProbeResult = { streaming: ProbeStep; tools: ProbeStep };

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
  const lines = [line("streaming", result.streaming), line("tools", result.tools)];
  if (!result.streaming.ok) {
    lines.push(
      "the endpoint did not stream a completion; check LLM_BASE_URL, LLM_API_KEY and LLM_MODEL",
    );
  }
  lines.push(
    `suggested ASK_TOOLS=${suggestAskTools({ streaming: result.streaming.ok, tools: result.tools.ok })}`,
  );
  return lines;
}
