// External MCP tools (search and the like) handed to the model by the Ask service, behind guards:
// only allow-listed tools are exposed, arguments that carry the user's private amounts never leave
// the process, results are size-capped and marked untrusted, and every call has a deadline.
// Whatever a server says is data, never instructions, and never reaches the model as error text.
import { createMCPClient } from "@ai-sdk/mcp";
import { type ToolSet, tool } from "ai";
import { argsLeakPrivateData, leakMessage } from "@/ask/privacy";
import { collectNumbers } from "@/ask/verify";
import type { McpServerConfig } from "@/config/env";
import { logger } from "@/lib/logger";

/** Serialized (UTF-8) size of a server result that reaches the model. */
export const MAX_MCP_RESULT_BYTES = 12 * 1024;

/** An error code worth logging (a Node code); anything else could carry text. */
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;

export type McpClientLike = { tools(): Promise<ToolSet>; close(): Promise<void> };
export type McpConnect = (
  config: McpServerConfig,
  headers: Record<string, string>,
) => Promise<McpClientLike>;

/** Header values are passed straight to the transport; they are never logged or returned. */
const defaultConnect: McpConnect = async (config, headers) => {
  const client = await createMCPClient({
    transport: { type: config.transport, url: config.url, headers },
  });
  // The client's own tool type is looser than ToolSet (unknown input); the shape is the same.
  return { tools: async () => (await client.tools()) as ToolSet, close: () => client.close() };
};

type Input = {
  servers: McpServerConfig[];
  env: Record<string, string | undefined>;
  privateNumbers: number[];
  groundedSink: number[][];
  toolTimeoutMs: number;
  connect?: McpConnect;
};

const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SAFE_CODE.test(code) ? { code } : {};
};

async function closeQuietly(client: McpClientLike) {
  try {
    await client.close();
  } catch {
    // Nothing useful to do with a failed close.
  }
}

/** The text cut to at most `limit` UTF-8 bytes without leaving half a character at the end. */
function truncateBytes(text: string, limit: number): string {
  const cut = new TextDecoder().decode(new TextEncoder().encode(text).slice(0, limit));
  return cut.endsWith("�") ? cut.slice(0, -1) : cut;
}

/** The result itself when it fits MAX_MCP_RESULT_BYTES serialized, else its serialization cut to fit. */
function capContent(result: unknown): { content: unknown; truncated?: true } {
  const serialized = JSON.stringify(result);
  if (serialized === undefined) return { content: null };
  if (new TextEncoder().encode(serialized).length <= MAX_MCP_RESULT_BYTES) {
    return { content: result };
  }
  return { content: truncateBytes(serialized, MAX_MCP_RESULT_BYTES), truncated: true };
}

/** Rejects when `signal` aborts, so a server that ignores the signal still cannot stall the answer. */
function aborted(signal: AbortSignal): { promise: Promise<never>; stop(): void } {
  let onAbort = () => {};
  const promise = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // Never an unhandled rejection when the call settled first.
  promise.catch(() => {});
  return { promise, stop: () => signal.removeEventListener("abort", onAbort) };
}

export async function openMcpTools({
  servers,
  env,
  privateNumbers,
  groundedSink,
  toolTimeoutMs,
  connect = defaultConnect,
}: Input): Promise<{ tools: ToolSet; failed: string[]; close(): Promise<void> }> {
  const clients: McpClientLike[] = [];
  const tools: ToolSet = {};
  const failed: string[] = [];

  /** Connects and lists tools within the deadline; a client that arrives late is closed. */
  async function openServer(server: McpServerConfig, headers: Record<string, string>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), toolTimeoutMs);
    });
    const opening = (async () => {
      const client = await connect(server, headers);
      try {
        return { client, listed: await client.tools() };
      } catch (error) {
        await closeQuietly(client);
        throw error;
      }
    })();
    try {
      return await Promise.race([opening, deadline]);
    } catch (error) {
      opening.then(
        ({ client }) => closeQuietly(client),
        () => {},
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function guard(server: McpServerConfig, name: string, original: ToolSet[string]) {
    const exposed = `${server.name}__${name}`;
    const execute = original.execute as (
      args: unknown,
      options: { abortSignal?: AbortSignal },
    ) => unknown;
    return tool({
      description: original.description,
      inputSchema: original.inputSchema,
      execute: async (args: unknown, options) => {
        if (argsLeakPrivateData(args, privateNumbers)) {
          return { error: "blocked_private_data", message: leakMessage };
        }
        const timeout = AbortSignal.timeout(toolTimeoutMs);
        const signal = options?.abortSignal
          ? AbortSignal.any([options.abortSignal, timeout])
          : timeout;
        const stop = aborted(signal);
        try {
          const raw = await Promise.race([
            Promise.resolve(execute(args, { ...options, abortSignal: signal })),
            stop.promise,
          ]);
          const wrapped = { source: server.name, untrusted: true, ...capContent(raw) };
          groundedSink.push(collectNumbers(wrapped));
          return wrapped;
        } catch (error) {
          logger.warn({ tool: exposed, ...safeCode(error) }, "ask mcp tool failed");
          return { error: "tool_failed", tool: exposed };
        } finally {
          stop.stop();
        }
      },
    });
  }

  await Promise.all(
    servers.map(async (server) => {
      const headers: Record<string, string> = {};
      for (const [header, variable] of Object.entries(server.headerEnv)) {
        const value = env[variable];
        if (value === undefined || value === "") {
          logger.warn({ server: server.name }, "ask mcp server skipped: header variable not set");
          failed.push(server.name);
          return;
        }
        headers[header] = value;
      }
      try {
        const { client, listed } = await openServer(server, headers);
        clients.push(client);
        for (const [name, original] of Object.entries(listed)) {
          if (server.allow.includes(name)) {
            tools[`${server.name}__${name}`] = guard(server, name, original);
          }
        }
      } catch (error) {
        logger.warn({ server: server.name, ...safeCode(error) }, "ask mcp server unavailable");
        failed.push(server.name);
      }
    }),
  );

  return {
    tools,
    failed,
    close: async () => {
      await Promise.all(clients.map(closeQuietly));
    },
  };
}
