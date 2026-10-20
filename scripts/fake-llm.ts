/**
 * A local stand-in for the LLM endpoint, for looking at the Ask screen without a real model.
 * Dev-only: nothing in the app imports it, and it contacts nothing; it only answers on 127.0.0.1.
 * Plain node:http, so it runs under Bun or Node and needs no extra type packages.
 *
 * Usage: bun run ask:fake-llm [port]      (the port may also come from FAKE_LLM_PORT; default 8787)
 * Then start the app with LLM_BASE_URL=http://127.0.0.1:<port>/v1 (see README, "Ask screen").
 *
 * It speaks the OpenAI-compatible `POST /v1/chat/completions` (streamed and not) and chooses what
 * to do from the text of the last user message:
 *   - contains "tool":  first a tool call to getMarketToday, then the answer once its result is back
 *   - contains "error": some text, then the connection breaks in the middle of the stream
 *   - contains "slow":  the long answer at about 150 ms per chunk, to try the stop button
 *   - anything else:    the answer at once (a few ms per chunk)
 * The answer has the seven headings, a source link, a number that is in no data (so it gets the
 * "no source" mark), a glossary term and the closing 「要不要我記住：」 line.
 *
 * It logs one line per request (kind and what it did), never a message, header or key. When the
 * client goes away mid-answer it logs "client closed", which is how the disconnect check in the
 * README sees that the model call really stopped.
 */

const DEFAULT_PORT = 8787;
const FAST_MS = 15;
const SLOW_MS = 150;

const ANSWER = [
  "**結論**",
  "今天大盤小幅整理，短線不必急著動作。",
  "",
  "**依據**",
  "ETF 的成交量沒有明顯放大，[新聞來源](https://example.com/news)也提到觀望氣氛偏重。",
  "我的粗估是這類產品一年大約有 87.65% 的波動，這個數字沒有出自任何資料。",
  "",
  "**情境**",
  "若量能回溫，族群輪動會變快；若量縮，維持區間整理。",
  "",
  "**對你的意義**",
  "你的投資期間比較長，短期波動不需要改變原本的計畫。",
  "",
  "**建議**",
  "維持原本的定期定額，不追高、不殺低。",
  "",
  "**一般選項**",
  "分批進場、保留緊急預備金，是常見的做法。",
  "",
  "**信心程度**",
  "中等，因為這只是一天的資料。",
  "",
  "要不要我記住：我兩年內想買房",
].join("\n");

const SLOW_ANSWER = [ANSWER, ANSWER, ANSWER].join("\n\n");

const ERROR_ANSWER = "**結論**\n先說結論：目前看起來偏中性，不過接下來";

type Mode = "tool" | "error" | "slow" | "default";

type ChatMessage = { role?: string; content?: unknown };
type ChatRequest = {
  messages?: ChatMessage[];
  tools?: { function?: { name?: string } }[];
  stream?: boolean;
  model?: string;
};

/** The text of a message whose content is a string or a list of parts. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
    )
    .join("");
}

/** Which scripted behaviour the last user message asks for. */
function modeOf(text: string): Mode {
  const lowered = text.toLowerCase();
  if (lowered.includes("tool")) return "tool";
  if (lowered.includes("error")) return "error";
  if (lowered.includes("slow")) return "slow";
  return "default";
}

/** Pieces of `text` of about `size` characters; the pieces join back into `text`. */
function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

let counter = 0;
/** Responses this script cuts off itself, which are not a client leaving. */
const cutOff = new WeakSet<ServerResponse>();

const sse = (data: unknown) =>
  `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

const USAGE = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 };

function log(n: number, line: string) {
  console.log(`[fake-llm] #${n} ${line}`);
}

type Emit = (delta: object, finish?: string) => void;

/**
 * Streams one completion. `steps` writes the deltas through `emit` and says whether the stream
 * ends well or is to be broken; a client that leaves early aborts `signal` and ends it at once.
 */
async function stream(
  n: number,
  model: string,
  res: ServerResponse,
  signal: AbortSignal,
  steps: (emit: Emit) => Promise<"ok" | "break">,
) {
  const id = `chatcmpl-fake-${n}`;
  const created = Math.floor(Date.now() / 1000);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  const emit: Emit = (delta, finish) => {
    if (signal.aborted) return;
    const choice = { index: 0, delta, finish_reason: finish ?? null };
    res.write(sse({ id, object: "chat.completion.chunk", created, model, choices: [choice] }));
  };
  const outcome = await steps(emit);
  if (signal.aborted) return;
  if (outcome === "break") {
    log(n, "breaking the stream");
    cutOff.add(res);
    res.destroy();
    return;
  }
  res.write(
    sse({ id, object: "chat.completion.chunk", created, model, choices: [], usage: USAGE }),
  );
  res.write(sse("[DONE]"));
  res.end();
  log(n, "done");
}

/** Streams `text` in pieces, `delayMs` apart. Returns early when the client has left. */
async function streamText(
  emit: Emit,
  text: string,
  size: number,
  delayMs: number,
  signal: AbortSignal,
) {
  emit({ role: "assistant", content: "" });
  for (const piece of pieces(text, size)) {
    if (signal.aborted) return;
    emit({ content: piece });
    await sleep(delayMs, signal);
  }
}

async function handle(
  n: number,
  request: ChatRequest,
  res: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const model = request.model ?? "fake-llm";
  const messages = request.messages ?? [];
  const lastUser = messages.findLast((message) => message.role === "user");
  const mode = modeOf(textOf(lastUser?.content));
  const toolsBack = messages.at(-1)?.role === "tool";
  const toolOffered = (request.tools ?? []).some((t) => t.function?.name === "getMarketToday");

  if (request.stream === false) {
    log(n, `non-streamed, mode=${mode}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-fake-${n}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          { index: 0, message: { role: "assistant", content: ANSWER }, finish_reason: "stop" },
        ],
        usage: USAGE,
      }),
    );
    return;
  }

  if (mode === "tool" && toolOffered && !toolsBack) {
    log(n, "tool call getMarketToday");
    await stream(n, model, res, signal, async (emit) => {
      emit({ role: "assistant", content: null });
      emit({
        tool_calls: [
          {
            index: 0,
            id: `call_fake_${n}`,
            type: "function",
            function: { name: "getMarketToday", arguments: "" },
          },
        ],
      });
      await sleep(300, signal);
      emit({ tool_calls: [{ index: 0, function: { arguments: "{}" } }] });
      emit({}, "tool_calls");
      return "ok";
    });
    return;
  }

  if (mode === "error") {
    log(n, "answer, then a broken stream");
    await stream(n, model, res, signal, async (emit) => {
      await streamText(emit, ERROR_ANSWER, 6, SLOW_MS / 3, signal);
      return "break";
    });
    return;
  }

  const slow = mode === "slow";
  log(n, slow ? "slow answer" : `answer${toolsBack ? " after tool result" : ""}`);
  await stream(n, model, res, signal, async (emit) => {
    const text = slow ? SLOW_ANSWER : ANSWER;
    await streamText(emit, text, slow ? 8 : 12, slow ? SLOW_MS : FAST_MS, signal);
    emit({}, "stop");
    return "ok";
  });
}

async function readJson(req: IncomingMessage): Promise<ChatRequest | null> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as ChatRequest;
  } catch {
    return null;
  }
}

const port = Number(process.argv[2] ?? process.env.FAKE_LLM_PORT ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("fake-llm: the port must be a number from 1 to 65535");
  process.exit(1);
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404).end("not found");
    return;
  }
  // Aborted when the client goes away before the response is complete.
  const n = ++counter;
  const gone = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded && !cutOff.has(res)) {
      gone.abort();
      log(n, "client closed");
    }
  });
  const body = await readJson(req);
  if (body === null) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid JSON" } }));
    return;
  }
  await handle(n, body, res, gone.signal);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`[fake-llm] listening on http://127.0.0.1:${port}/v1`);
});
