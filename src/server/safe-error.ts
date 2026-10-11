import { getEnv } from "@/config/env";
import { redactKey } from "@/sources/darkfanxing";

/** Error text for logs with the upstream key scrubbed (EnvError messages name keys, not values). */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  try {
    return redactKey(message, getEnv().DARKFANXING_KEY, "***");
  } catch {
    return message;
  }
}
