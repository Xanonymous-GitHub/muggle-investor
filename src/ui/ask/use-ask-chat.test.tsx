import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { ASK_LIMITS } from "@/ui/ask/limits";
import { buildAskBody } from "@/ui/ask/request";
import {
  CHAT_KEY,
  PROFILE_KEY,
  readChat,
  writeChat,
  writeHoldings,
  writeMemory,
} from "@/ui/ask/stores";
import {
  type ControlledStream,
  controlledStream,
  finishChunk,
  type StreamChunk,
  textChunks,
  uiStreamResponse,
} from "@/ui/ask/stream-fixture";
import { type AskChat, useAskChat } from "@/ui/ask/use-ask-chat";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider, useSettings } from "@/ui/device/settings-provider";
import { readItem, writeItem } from "@/ui/device/storage";
import { DRAFT_KEY, serializeDraft } from "@/ui/plan/draft";

type Call = { url: string; init: RequestInit; body: unknown; signal: AbortSignal };

/** A fake fetch that records its calls and answers with whatever `respond` returns. */
function fakeFetch(respond: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body)),
      signal: init?.signal as AbortSignal,
    };
    calls.push(call);
    return respond(call, calls.length - 1);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

function mount(fetchImpl: typeof fetch) {
  return renderHook(() => useAskChat({ fetchImpl }), { wrapper });
}

const answer = (...deltas: string[]) => uiStreamResponse([...textChunks(...deltas), finishChunk]);

const verification = (unsupported: string[] = [], checked = true): StreamChunk => ({
  type: "data-verification",
  data: { unsupported, checked },
});

/** Sends and waits until the answer has settled. */
async function ask(chat: { current: AskChat }, text: string) {
  act(() => chat.current.send(text));
  await waitFor(() => expect(chat.current.status).toBe("idle"));
}

const setOnline = (value: boolean) =>
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });

beforeEach(() => setOnline(true));
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useAskChat: a plain answer", () => {
  it("starts empty and idle", () => {
    const { fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    expect(result.current).toMatchObject({
      turns: [],
      status: "idle",
      error: null,
      signedOut: false,
    });
  });

  it("appends the user turn and a streaming assistant turn at once, then fills it from 3 deltas", async () => {
    const stream = { current: null as ControlledStream | null };
    const { fetchImpl } = fakeFetch((call) => {
      stream.current = controlledStream(call.signal);
      return stream.current.response;
    });
    const { result } = mount(fetchImpl);

    act(() => result.current.send("什麼是 ETF？"));
    expect(result.current.status).toBe("streaming");
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[0]).toMatchObject({ role: "user", text: "什麼是 ETF？" });
    expect(result.current.turns[1]).toMatchObject({
      role: "assistant",
      text: "",
      streaming: true,
      failed: false,
    });
    await waitFor(() => expect(stream.current).not.toBeNull());

    const live = stream.current as ControlledStream;
    for (const chunk of textChunks("ETF ", "是", "基金")) {
      await act(async () => live.push(chunk));
    }
    await waitFor(() => expect(result.current.turns[1]?.text).toBe("ETF 是基金"));
    expect(result.current.turns[1]?.streaming).toBe(true);

    await act(async () => {
      live.push(finishChunk);
      live.close();
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.turns[1]).toMatchObject({
      text: "ETF 是基金",
      streaming: false,
      failed: false,
    });
    expect(result.current.error).toBeNull();
  });

  it("reads an answer cut into 3-byte reads, with CRLF line ends", async () => {
    const { fetchImpl } = fakeFetch(() =>
      uiStreamResponse([...textChunks("你好", "，世界"), finishChunk], {
        bytesPerRead: 3,
        eol: "\r\n",
      }),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "嗨");
    expect(result.current.turns[1]).toMatchObject({ text: "你好，世界", failed: false });
  });

  it("posts to /api/ask without caching and with an AbortSignal", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("ok"));
    const { result } = mount(fetchImpl);
    await ask(result, "hi");
    expect(calls[0]?.url).toBe("/api/ask");
    expect(calls[0]?.init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(new Headers(calls[0]?.init.headers).get("content-type")).toBe("application/json");
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends exactly what buildAskBody builds for the same inputs", async () => {
    writeItem(SETTINGS_KEY, JSON.stringify({ lens: "pro", theme: "system" }));
    writeHoldings([{ symbol: "0050", amount: 1000 }]);
    writeMemory(["我不喜歡風險"]);
    const { calls, fetchImpl } = fakeFetch(() => answer("ok"));
    const { result } = mount(fetchImpl);
    await ask(result, "第一題");
    await ask(result, "第二題");
    expect(calls[1]?.body).toEqual(
      buildAskBody({
        lens: "pro",
        holdings: [{ symbol: "0050", amount: 1000 }],
        memory: ["我不喜歡風險"],
        plan: null,
        messages: [
          { role: "user", content: "第一題" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "第二題" },
        ],
      }),
    );
  });

  it("sends no profile when nothing is stored", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("ok"));
    const { result } = mount(fetchImpl);
    await ask(result, "hi");
    expect(calls[0]?.body).toEqual({
      lens: "beginner",
      messages: [{ role: "user", content: "hi" }],
    });
  });
});

describe("useAskChat: tools, notices and verification", () => {
  it("collects tools, notices and the verification", async () => {
    const chunks: StreamChunk[] = [
      { type: "start" },
      { type: "data-notice", data: { kind: "no_web", text: "這次沒有查網路" } },
      { type: "tool-input-start", toolCallId: "c1", toolName: "getQuote" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "getQuote", input: {} },
      { type: "tool-input-available", toolCallId: "c2", toolName: "getSector", input: {} },
      { type: "tool-output-available", toolCallId: "c1", output: { price: 1 } },
      ...textChunks("收盤 1 元"),
      { type: "data-notice", data: { kind: "timeout", text: "回答時間過長，已先停在這裡" } },
      verification(["99"]),
      finishChunk,
    ];
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(chunks));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({
      text: "收盤 1 元",
      notices: [
        { kind: "no_web", text: "這次沒有查網路" },
        { kind: "timeout", text: "回答時間過長，已先停在這裡" },
      ],
      verification: { unsupported: ["99"], checked: true },
      tools: [
        { name: "getQuote", done: true },
        { name: "getSector", done: false },
      ],
      failed: false,
    });
  });

  it("marks a tool done on a tool error and ignores a preliminary output", async () => {
    const chunks: StreamChunk[] = [
      { type: "tool-input-available", toolCallId: "a", toolName: "one", input: {} },
      { type: "tool-input-available", toolCallId: "b", toolName: "two", input: {} },
      { type: "tool-output-available", toolCallId: "a", output: 1, preliminary: true },
      { type: "tool-output-error", toolCallId: "b", errorText: "x" },
      ...textChunks("done"),
      finishChunk,
    ];
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(chunks));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]?.tools).toEqual([
      { name: "one", done: false },
      { name: "two", done: true },
    ]);
  });

  it("ignores malformed notices, unknown chunks and bad JSON", async () => {
    const chunks: StreamChunk[] = [
      { type: "data-notice", data: { kind: "weird", text: "x" } },
      { type: "data-notice", data: "nope" },
      { type: "data-verification", data: { unsupported: "no", checked: true } },
      { type: "reasoning-delta", id: "r", delta: "secret thoughts" },
      { type: "something-new" },
      ...textChunks("ok"),
      finishChunk,
    ];
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(chunks));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({
      text: "ok",
      notices: [],
      verification: null,
      failed: false,
    });
  });
});

describe("useAskChat: errors inside the stream", () => {
  it("keeps the text and marks the turn failed on an error chunk", async () => {
    const chunks: StreamChunk[] = [
      ...textChunks("先講一半"),
      { type: "error", errorText: "發生錯誤，請稍後再試。" },
      verification(),
      finishChunk,
    ];
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(chunks));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({
      text: "先講一半",
      failed: true,
      streaming: false,
    });
    expect(result.current.error).toBeNull();
  });

  it("marks the turn failed when the connection drops mid-answer", async () => {
    let stream: ControlledStream | null = null;
    const { fetchImpl } = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const { result } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("半句")) await act(async () => stream?.push(chunk));
    await act(async () => stream?.fail());
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.turns[1]).toMatchObject({ text: "半句", failed: true, streaming: false });
  });

  it("marks the turn failed when the stream ends without a finish chunk", async () => {
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(textChunks("斷了")));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({ text: "斷了", failed: true });
  });
});

describe("useAskChat: errors before the stream", () => {
  async function failWith(response: Response | Error, online = true) {
    setOnline(online);
    const { fetchImpl } = fakeFetch(() => {
      if (response instanceof Error) throw response;
      return response;
    });
    const hook = mount(fetchImpl);
    await ask(hook.result, "q");
    return hook.result.current;
  }

  it("401: signed out, error signed_out, no assistant turn left behind", async () => {
    const chat = await failWith(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect(chat.signedOut).toBe(true);
    expect(chat.error).toEqual({ kind: "signed_out" });
    expect(chat.turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("413: too_large", async () => {
    const chat = await failWith(Response.json({ error: "too_large" }, { status: 413 }));
    expect(chat.error).toEqual({ kind: "too_large" });
    expect(chat.signedOut).toBe(false);
    expect(chat.turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("429: rate_limited with the used and limit headers", async () => {
    const chat = await failWith(
      Response.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { "x-ask-used": "20", "x-ask-limit": "20", "retry-after": "3600" },
        },
      ),
    );
    expect(chat.error).toEqual({ kind: "rate_limited", used: 20, limit: 20 });
    expect(chat.turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("429 without readable headers: rate_limited with nulls", async () => {
    const chat = await failWith(
      Response.json({}, { status: 429, headers: { "x-ask-used": "abc" } }),
    );
    expect(chat.error).toEqual({ kind: "rate_limited", used: null, limit: null });
  });

  it("503: unavailable", async () => {
    const chat = await failWith(Response.json({ error: "llm_unavailable" }, { status: 503 }));
    expect(chat.error).toEqual({ kind: "unavailable" });
  });

  it.each([400, 500])("%i: failed", async (status) => {
    const chat = await failWith(Response.json({ error: "x" }, { status }));
    expect(chat.error).toEqual({ kind: "failed" });
  });

  it("a network error is failed while online", async () => {
    const chat = await failWith(new TypeError("Failed to fetch"));
    expect(chat.error).toEqual({ kind: "failed" });
  });

  it("a network error is offline when the browser is offline", async () => {
    const chat = await failWith(new TypeError("Failed to fetch"), false);
    expect(chat.error).toEqual({ kind: "offline" });
  });

  it("a 2xx without a body is failed", async () => {
    const chat = await failWith(new Response(null, { status: 200 }));
    expect(chat.error).toEqual({ kind: "failed" });
    expect(chat.turns.map((t) => t.role)).toEqual(["user"]);
  });

  it("clears the error when the next question goes out", async () => {
    let first = true;
    const { fetchImpl } = fakeFetch(() => {
      if (first) {
        first = false;
        return Response.json({}, { status: 503 });
      }
      return answer("好");
    });
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.error).toEqual({ kind: "unavailable" });
    act(() => result.current.send("q2"));
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("idle"));
  });
});

describe("useAskChat: what send refuses", () => {
  it("ignores empty and whitespace-only text", () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    act(() => result.current.send(""));
    act(() => result.current.send("  \n\t "));
    expect(calls).toHaveLength(0);
    expect(result.current.turns).toEqual([]);
    expect(result.current.status).toBe("idle");
  });

  it("ignores text over 4000 characters but sends exactly 4000", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    act(() => result.current.send("a".repeat(ASK_LIMITS.maxMessageChars + 1)));
    expect(calls).toHaveLength(0);
    expect(result.current.turns).toEqual([]);
    await ask(result, "a".repeat(ASK_LIMITS.maxMessageChars));
    expect(calls).toHaveLength(1);
  });

  it("ignores a second send while streaming", async () => {
    const { calls, fetchImpl } = fakeFetch((call) => controlledStream(call.signal).response);
    const { result } = mount(fetchImpl);
    act(() => {
      result.current.send("one");
      result.current.send("two");
    });
    act(() => result.current.send("three"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(result.current.turns.map((t) => t.text)).toEqual(["one", ""]);
  });

  it("sends the trimmed text", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    await ask(result, "  hi \n");
    expect(calls[0]?.body).toMatchObject({ messages: [{ role: "user", content: "hi" }] });
  });
});

describe("useAskChat: stop", () => {
  it("aborts, keeps the partial text and marks the turn not streaming", async () => {
    let stream: ControlledStream | null = null;
    const { calls, fetchImpl } = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const { result } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("半")) await act(async () => stream?.push(chunk));
    await waitFor(() => expect(result.current.turns[1]?.text).toBe("半"));

    act(() => result.current.stop());
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.turns[1]).toMatchObject({
      text: "半",
      streaming: false,
      failed: false,
      stopped: true,
    });
    expect(result.current.error).toBeNull();

    // The aborted stream's rejection must not change anything afterwards.
    await act(async () => {});
    expect(result.current.turns[1]).toMatchObject({ text: "半", streaming: false, failed: false });
    expect(result.current.error).toBeNull();
    // A stopped partial answer is kept on the device, marked as partial.
    expect(readChat()).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "半", partial: true },
    ]);
  });

  it("a stopped answer is still stopped after a reload; a finished one is not", async () => {
    let stream: ControlledStream | null = null;
    const first = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const before = mount(first.fetchImpl);
    act(() => before.result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("半")) await act(async () => stream?.push(chunk));
    await waitFor(() => expect(before.result.current.turns[1]?.text).toBe("半"));
    act(() => before.result.current.stop());
    before.unmount();

    const after = mount(fakeFetch(() => answer("x")).fetchImpl);
    await waitFor(() => expect(after.result.current.turns).toHaveLength(2));
    expect(after.result.current.turns[1]).toMatchObject({
      text: "半",
      streaming: false,
      failed: false,
      stopped: true,
    });
    expect(after.result.current.turns[0]).toMatchObject({ stopped: false });
    // The marker is not lost when the restored chat is written again.
    await ask(after.result, "q2");
    expect(readChat()[1]).toEqual({ role: "assistant", content: "半", partial: true });
    expect(after.result.current.turns[3]).toMatchObject({ stopped: false });
  });

  it("an old stored chat without the marker loads as finished", async () => {
    writeChat([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
    const { result } = mount(fakeFetch(() => answer("x")).fetchImpl);
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(result.current.turns[1]).toMatchObject({ stopped: false, failed: false });
  });

  it("drops the empty assistant turn when stopped before any text, and the question can be re-asked", async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch((call) =>
      n++ === 0 ? controlledStream(call.signal).response : answer("好"),
    );
    const { result } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => result.current.stop());
    expect(result.current.turns.map((t) => t.role)).toEqual(["user"]);
    expect(result.current.status).toBe("idle");

    await ask(result, "q");
    expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      "user:q",
      "assistant:好",
    ]);
  });

  it.each([
    ["a notice", { type: "data-notice", data: { kind: "no_web", text: "這次沒有查網路" } }],
    ["a tool call", { type: "tool-input-start", toolCallId: "c1", toolName: "getQuote" }],
  ] as [string, StreamChunk][])(
    "stopped after %s but before any text: drops the turn and a re-ask reuses the question",
    async (_name, chunk) => {
      let n = 0;
      const { calls, fetchImpl } = fakeFetch((call) => {
        if (n++ > 0) return answer("好");
        const stream = controlledStream(call.signal);
        stream.push(chunk);
        return stream.response;
      });
      const { result } = mount(fetchImpl);
      act(() => result.current.send("q"));
      await waitFor(() => expect(calls).toHaveLength(1));
      await waitFor(() => {
        const turn = result.current.turns[1];
        expect((turn?.notices.length ?? 0) + (turn?.tools.length ?? 0)).toBe(1);
      });
      act(() => result.current.stop());
      expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual(["user:q"]);

      await ask(result, "q");
      expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
        "user:q",
        "assistant:好",
      ]);
      expect(calls[1]?.body).toMatchObject({ messages: [{ role: "user", content: "q" }] });
      expect(result.current.turns[1]).toMatchObject({ notices: [], tools: [], stopped: false });
    },
  );

  it("is harmless when nothing is running", () => {
    const { fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    act(() => result.current.stop());
    expect(result.current.status).toBe("idle");
  });
});

describe("useAskChat: unmount", () => {
  it("aborts the fetch and sets no state afterwards", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let stream: ControlledStream | null = null;
    const { calls, fetchImpl } = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const { result, unmount } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("半")) await act(async () => stream?.push(chunk));
    const before = result.current.turns;
    unmount();
    expect(calls[0]?.signal.aborted).toBe(true);
    await act(async () => {
      stream?.push({ type: "text-delta", id: "t1", delta: "late" });
      stream?.fail();
    });
    // The last render is untouched by what arrives after the unmount.
    expect(result.current.turns).toBe(before);
    expect(result.current.turns[1]?.text).toBe("半");
    expect(errors).not.toHaveBeenCalled();
    // Nothing was persisted for the unfinished answer.
    expect(readItem(CHAT_KEY)).toBeNull();
  });

  it("aborts a request still waiting for its response, with no warning", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { calls, fetchImpl } = fakeFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const { result, unmount } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(calls).toHaveLength(1));
    unmount();
    await act(async () => {});
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("useAskChat: the stored chat", () => {
  it("restores the stored chat on mount as finished turns", async () => {
    writeChat([
      { role: "user", content: "舊問題" },
      { role: "assistant", content: "舊答案" },
    ]);
    const { fetchImpl } = fakeFetch(() => answer("x"));
    const { result } = mount(fetchImpl);
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(result.current.turns[0]).toMatchObject({ role: "user", text: "舊問題" });
    expect(result.current.turns[1]).toMatchObject({
      role: "assistant",
      text: "舊答案",
      notices: [],
      verification: null,
      tools: [],
      streaming: false,
      failed: false,
    });
    expect(new Set(result.current.turns.map((t) => t.id)).size).toBe(2);
    expect(result.current.status).toBe("idle");
  });

  it("sends the restored messages with the next question", async () => {
    writeChat([
      { role: "user", content: "舊問題" },
      { role: "assistant", content: "舊答案" },
    ]);
    const { calls, fetchImpl } = fakeFetch(() => answer("新"));
    const { result } = mount(fetchImpl);
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    await ask(result, "新問題");
    expect(calls[0]?.body).toMatchObject({
      messages: [
        { role: "user", content: "舊問題" },
        { role: "assistant", content: "舊答案" },
        { role: "user", content: "新問題" },
      ],
    });
  });

  it("persists the text only after the answer completes, not while streaming", async () => {
    let stream: ControlledStream | null = null;
    const { fetchImpl } = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const { result } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("答", "案")) await act(async () => stream?.push(chunk));
    await waitFor(() => expect(result.current.turns[1]?.text).toBe("答案"));
    expect(readItem(CHAT_KEY)).toBeNull();

    await act(async () => {
      stream?.push(verification());
      stream?.push(finishChunk);
      stream?.close();
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(readChat()).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "答案" },
    ]);
  });

  it("does not persist after a request that failed before the stream", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({}, { status: 503 }));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(readItem(CHAT_KEY)).toBeNull();
  });

  it("newChat clears the turns, the error and the stored chat", async () => {
    const { fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(readItem(CHAT_KEY)).not.toBeNull();
    act(() => result.current.newChat());
    expect(result.current.turns).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(readItem(CHAT_KEY)).toBeNull();
  });

  it("newChat aborts an answer in progress and ignores what it still delivers", async () => {
    let stream: ControlledStream | null = null;
    const { calls, fetchImpl } = fakeFetch((call) => {
      stream = controlledStream(call.signal);
      return stream.response;
    });
    const { result } = mount(fetchImpl);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).not.toBeNull());
    for (const chunk of textChunks("半")) await act(async () => stream?.push(chunk));
    act(() => result.current.newChat());
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.turns).toEqual([]);
    await act(async () => {
      stream?.push({ type: "text-delta", id: "t1", delta: "late" });
    });
    expect(result.current.turns).toEqual([]);
    expect(readItem(CHAT_KEY)).toBeNull();
  });

  it("works when the device cannot store anything", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({ text: "好", failed: false });
  });
});

describe("useAskChat: retry", () => {
  it("resends the same text after an HTTP error without duplicating the user turn", async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch(() =>
      n++ === 0 ? Response.json({}, { status: 503 }) : answer("好了"),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns.map((t) => t.role)).toEqual(["user"]);
    await ask(result, "q");
    expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      "user:q",
      "assistant:好了",
    ]);
    expect(calls[1]?.body).toMatchObject({ messages: [{ role: "user", content: "q" }] });
  });

  it("replaces a failed assistant turn instead of keeping both", async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch(() =>
      n++ === 0
        ? uiStreamResponse([...textChunks("一半"), { type: "error", errorText: "x" }, finishChunk])
        : answer("完整答案"),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]?.failed).toBe(true);
    await ask(result, "q");
    expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      "user:q",
      "assistant:完整答案",
    ]);
    expect(result.current.turns[1]?.failed).toBe(false);
    // The failed half answer is not part of what is asked again.
    expect(calls[1]?.body).toMatchObject({ messages: [{ role: "user", content: "q" }] });
    expect(readChat()).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "完整答案" },
    ]);
  });

  it("asks the same text again as a new question after a good answer", async () => {
    const { fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    await ask(result, "q");
    expect(result.current.turns.map((t) => t.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("keeps a failed answer and asks a different question after it", async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch(() =>
      n++ === 0
        ? uiStreamResponse([...textChunks("一半"), { type: "error", errorText: "x" }, finishChunk])
        : answer("另一個答案"),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "q1");
    await ask(result, "q2");
    expect(result.current.turns.map((t) => t.text)).toEqual(["q1", "一半", "q2", "另一個答案"]);
    expect(calls[1]?.body).toMatchObject({
      messages: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "一半" },
        { role: "user", content: "q2" },
      ],
    });
  });
});

describe("useAskChat: failed answers are not stored", () => {
  it("keeps the question but not the failed answer in the stored chat", async () => {
    const { fetchImpl } = fakeFetch(() =>
      uiStreamResponse([...textChunks("一半"), { type: "error", errorText: "x" }, finishChunk]),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({ text: "一半", failed: true, stopped: false });
    expect(readChat()).toEqual([{ role: "user", content: "q" }]);
  });

  it("a stream cut short is failed, not stopped, and not stored", async () => {
    const { fetchImpl } = fakeFetch(() => uiStreamResponse(textChunks("斷了")));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({ failed: true, stopped: false });
    expect(readChat()).toEqual([{ role: "user", content: "q" }]);
  });

  it("a finished answer is neither failed nor stopped", async () => {
    const { fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.turns[1]).toMatchObject({ failed: false, stopped: false });
  });
});

describe("useAskChat: an unanswered question", () => {
  it("is dropped when a different question is sent after an HTTP error", async () => {
    let n = 0;
    const { calls, fetchImpl } = fakeFetch(() =>
      n++ === 0 ? Response.json({}, { status: 503 }) : answer("好"),
    );
    const { result } = mount(fetchImpl);
    await ask(result, "舊問題");
    expect(result.current.turns.map((t) => t.text)).toEqual(["舊問題"]);
    await ask(result, "新問題");
    expect(result.current.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      "user:新問題",
      "assistant:好",
    ]);
    expect(calls[1]?.body).toMatchObject({ messages: [{ role: "user", content: "新問題" }] });
  });
});

describe("useAskChat: signedOut", () => {
  const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });

  it("is reset by newChat", async () => {
    const { fetchImpl } = fakeFetch(unauthorized);
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.signedOut).toBe(true);
    act(() => result.current.newChat());
    expect(result.current.signedOut).toBe(false);
  });

  it("is reset when the next question goes out", async () => {
    let n = 0;
    const { fetchImpl } = fakeFetch(() => (n++ === 0 ? unauthorized() : answer("好")));
    const { result } = mount(fetchImpl);
    await ask(result, "q");
    expect(result.current.signedOut).toBe(true);
    act(() => result.current.send("q"));
    expect(result.current.signedOut).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.signedOut).toBe(false);
  });
});

describe("useAskChat: what goes out besides the question", () => {
  const FULL_DRAFT = {
    answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0]?.id ?? ""])),
    amounts: {
      lump: "600000",
      monthly: "15000",
      monthlyExpenses: "30000",
      existingReserve: "90000",
    },
  };

  it("sends profile.plan only with the opt-in on and a complete draft", async () => {
    writeItem(DRAFT_KEY, serializeDraft(FULL_DRAFT));
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = mount(fetchImpl);

    await ask(result, "off");
    expect(calls[0]?.body).not.toHaveProperty("profile");

    writeItem(PROFILE_KEY, JSON.stringify({ plan: true }));
    await ask(result, "on");
    expect(calls[1]?.body).toMatchObject({
      profile: { plan: { lump: 600000, monthly: 15000 }, holdings: [], memory: [] },
    });

    window.localStorage.removeItem(DRAFT_KEY);
    await ask(result, "no draft");
    expect(calls[2]?.body).not.toHaveProperty("profile");
  });

  it("picks up a lens change between two questions", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    const { result } = renderHook(
      () => ({ chat: useAskChat({ fetchImpl }), settings: useSettings() }),
      { wrapper },
    );
    const chat = {
      get current() {
        return result.current.chat;
      },
    };
    await ask(chat, "一");
    act(() => result.current.settings.setLens("pro"));
    await ask(chat, "二");
    expect(calls.map((c) => (c.body as { lens: string }).lens)).toEqual(["beginner", "pro"]);
  });
});
