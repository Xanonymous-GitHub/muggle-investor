// Fakes shared by the Ask service tests: a scripted language model, a fake MCP server and readers
// for the UI message stream a response carries.
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { vi } from "vitest";
import type { McpClientLike } from "@/ask/tools/mcp";
import type { McpServerConfig } from "@/config/env";

export type CallOptions = MockLanguageModelV4["doStreamCalls"][number];
export type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;

export const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

export function streamOf(parts: LanguageModelV4StreamPart[]): StreamResult {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

export const textReply = (text: string, tokens = usage(100, 20)): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "finish", usage: tokens, finishReason: { unified: "stop", raw: "stop" } },
  ]);

export const toolCallReply = (toolName: string, input: unknown, id = "call-1"): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    {
      type: "finish",
      usage: usage(50, 10),
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    },
  ]);

/** One step in which the model asks for several tools at once. */
export const toolCallsReply = (
  calls: { toolName: string; input: unknown; id?: string }[],
): StreamResult =>
  streamOf([
    { type: "stream-start", warnings: [] },
    ...calls.map((call, index) => ({
      type: "tool-call" as const,
      toolCallId: call.id ?? `call-${index + 1}`,
      toolName: call.toolName,
      input: JSON.stringify(call.input),
    })),
    {
      type: "finish",
      usage: usage(50, 10),
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
    },
  ]);

/** A fake model whose n-th call (0-based) is answered by `reply(n, options)`. */
export function fakeModel(
  reply: (call: number, options: CallOptions) => StreamResult | Promise<StreamResult>,
) {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => reply(calls++, options),
  });
}

export type Chunk = { type: string; [key: string]: unknown };

/** The UI message chunks of an SSE response body. */
export async function chunksOf(response: Response): Promise<Chunk[]> {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Chunk);
}

export const textOf = (chunks: Chunk[]) =>
  chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.delta)
    .join("");
export const notices = (chunks: Chunk[]) =>
  chunks.filter((c) => c.type === "data-notice").map((c) => c.data as { kind: string });
export const verificationOf = (chunks: Chunk[]) =>
  chunks.find((c) => c.type === "data-verification")?.data as
    | import("@/ask/ask-message").AskVerification
    | undefined;

/** Every value of every tool-result message in a prompt. */
export function toolResultsIn(options: CallOptions): unknown[] {
  const out: unknown[] = [];
  for (const message of options.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") out.push(part.output);
    }
  }
  return out;
}

export const SEARCH: McpServerConfig = {
  name: "search",
  url: "https://mcp.example.com/mcp",
  transport: "http",
  headerEnv: {},
  allow: ["web_search"],
  policy: {},
};
export const NEWS: McpServerConfig = {
  ...SEARCH,
  name: "news",
  url: "https://news.example.com/mcp",
};

export function fakeMcpClient(handler: (args: unknown) => unknown) {
  const remote = vi.fn(handler);
  const close = vi.fn(async () => {});
  const client: McpClientLike = {
    tools: async () => ({
      web_search: {
        description: "search the web",
        inputSchema: jsonSchema({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        }),
        execute: async (args: unknown) => remote(args),
      },
    }),
    close,
  };
  return { client, remote, close };
}
