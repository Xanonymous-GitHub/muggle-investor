// Chaining for the Responses API: after a tool call, the next request names the response that made
// it (`previous_response_id`) and carries only the tool results. Some gateways accept nothing else
// (a replayed history answers `invalid_tool_continuation`), and it is what the API is designed for:
// the server already holds the conversation up to that response.
import type { ProviderMetadata } from "ai";

type Item = { type?: string; role?: string; content?: unknown };

const isInstruction = (item: Item) => item.role === "system" || item.role === "developer";

/** The text of a system/developer item: a string, or the text parts of a content array. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "",
    )
    .join("");
}

/**
 * Cuts a request that continues a previous response down to what the server does not have yet:
 * the tool results after the last function call. Instructions are not inherited from the previous
 * response, so the system/developer items move to the top-level `instructions` field (a gateway
 * may refuse them as input items next to a tool result). Any other request is returned as is.
 */
export function trimToPendingOutputs<T extends Record<string, unknown>>(body: T): T {
  const { input, previous_response_id: previous } = body;
  if (typeof previous !== "string" || !Array.isArray(input)) return body;
  const items = input as Item[];
  const lastCall = items.findLastIndex((item) => item.type === "function_call");
  if (lastCall === -1) return body;
  const instructions = [
    typeof body.instructions === "string" ? body.instructions : "",
    ...items
      .slice(0, lastCall)
      .filter(isInstruction)
      .map((item) => textOf(item.content)),
  ].filter((text) => text !== "");
  return {
    ...body,
    ...(instructions.length > 0 && { instructions: instructions.join("\n\n") }),
    input: items.slice(lastCall + 1),
  };
}

/** `fetch` that applies {@link trimToPendingOutputs} to JSON request bodies. */
export function chainResponsesFetch(base: typeof fetch = fetch): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (typeof init?.body !== "string") return base(input, init);
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        return base(input, init);
      }
      const trimmed = trimToPendingOutputs(body);
      return base(input, trimmed === body ? init : { ...init, body: JSON.stringify(trimmed) });
    },
    base,
  ) as typeof fetch;
}

/**
 * For `streamText`'s `prepareStep`: points the next step at the response the previous step
 * produced. Does nothing for a model that reports no response id (the chat API), so it is safe to
 * pass whatever the model.
 */
export function chainToPreviousResponse({
  steps,
}: {
  steps: readonly { providerMetadata?: ProviderMetadata | undefined }[];
}): { providerOptions?: { openai: { previousResponseId: string } } } {
  const responseId = steps.at(-1)?.providerMetadata?.openai?.responseId;
  return typeof responseId === "string"
    ? { providerOptions: { openai: { previousResponseId: responseId } } }
    : {};
}
