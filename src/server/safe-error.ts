import { getEnv } from "@/config/env";
import { redactKey } from "@/sources/darkfanxing";

/** Error text for logs with the upstream and LLM keys scrubbed (EnvError messages name keys, not values). */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    const env = getEnv();
    return redactKey(redactKey(message, env.DARKFANXING_KEY, "***"), env.LLM_API_KEY, "***");
  } catch {
    return message;
  }
}
