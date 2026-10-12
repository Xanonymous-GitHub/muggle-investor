/**
 * The model's output could not be turned into the requested object. The message is a short reason
 * and never holds the prompt, the API key or request details; at most a bounded excerpt of the
 * model's own output.
 */
export class LlmOutputError extends Error {
  override readonly name = "LlmOutputError";
}

const FENCED_BLOCK = /```(?:json)?[^\S\n]*\n([\s\S]*?)```/i;

/**
 * Returns the first balanced `{...}` in a model reply, parsed. A ```json fenced block is searched
 * first; prose before or after the object is ignored. Throws `LlmOutputError` when no complete
 * object exists or it is not valid JSON.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = FENCED_BLOCK.exec(text)?.[1];
  const candidate = (fenced === undefined ? null : findObject(fenced)) ?? findObject(text);
  if (candidate === null) throw new LlmOutputError("no JSON object found in model output");
  if (candidate === undefined)
    throw new LlmOutputError("model output has an unterminated JSON object");
  try {
    return JSON.parse(candidate);
  } catch {
    throw new LlmOutputError("model output is not valid JSON");
  }
}

/** The first balanced object's source; `null` when there is no `{`, `undefined` when it never closes. */
function findObject(text: string): string | null | undefined {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
