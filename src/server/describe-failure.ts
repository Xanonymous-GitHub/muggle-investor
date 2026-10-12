import { EnvError } from "@/config/env";
import { LlmOutputError } from "@/insight/llm";

// Server-only. For CLI output where nothing from the failure may leak: error messages can carry
// a slice of the model's reply, validation text, request URLs or SQL parameters (briefing
// content), so this reads only the error's class name and picks a fixed reason from it.

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const nameOf = (error: Error): string => (SAFE_NAME.test(error.name) ? error.name : "Error");

/** `LlmOutputError` messages starting like this mean the request itself failed, not the reply. */
const REQUEST_FAILURE = /^LLM request (failed|timed out)/;

/**
 * One line naming the failure by class and a fixed category, never by message. `EnvError` also
 * lists the names (not values) of the invalid variables.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof EnvError)
    return `EnvError: invalid environment variables: ${error.keys.join(", ")}`;
  if (error instanceof LlmOutputError) {
    return REQUEST_FAILURE.test(error.message)
      ? `${error.name}: LLM request failed`
      : `${error.name}: model output rejected`;
  }
  if (error instanceof Error) return `${nameOf(error)}: unexpected error`;
  return "unexpected error";
}
