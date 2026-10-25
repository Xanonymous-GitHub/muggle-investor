import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { keysWithPrefix, writeItem } from "@/ui/device/storage";
import { DRAFT_KEY } from "@/ui/plan/draft";
import { AskChat } from "./ask-chat";
import { ASK_COPY } from "./copy";
import {
  ACK_KEY,
  CHAT_KEY,
  MEMORY_KEY,
  readDraft,
  readMemory,
  writeAck,
  writeChat,
  writeDraft,
  writeHoldings,
  writeMemory,
} from "./stores";
import {
  controlledStream,
  finishChunk,
  type StreamChunk,
  textChunks,
  uiStreamResponse,
} from "./stream-fixture";

// The glossary comes over the network in the app; the bundled one stands in.
vi.mock("@/ui/glossary/use-glossary", () => ({
  useGlossary: () => ({
    terms: GLOSSARY,
    byId: Object.fromEntries(GLOSSARY.map((term) => [term.id, term])),
    status: "ready",
  }),
}));

const VERDICT = "這是 AI 的觀點，不是保證，也不構成投資建議。";

type Call = { body: { messages: { role: string; content: string }[] } };

function fakeFetch(respond: (index: number, signal: AbortSignal) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return respond(calls.length - 1, init?.signal as AbortSignal);
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const answer = (...deltas: string[]) => uiStreamResponse([...textChunks(...deltas), finishChunk]);

function mount(
  fetchImpl: typeof fetch,
  props: { onSignedOut?: (question?: string) => void; initialDraft?: string } = {},
) {
  const onSignedOut = props.onSignedOut ?? vi.fn();
  const wrap = (node: ReactNode) => <SettingsProvider>{node}</SettingsProvider>;
  const view = render(
    wrap(
      <AskChat fetchImpl={fetchImpl} onSignedOut={onSignedOut} initialDraft={props.initialDraft} />,
    ),
  );
  return { ...view, onSignedOut };
}

const box = () => screen.getByRole("textbox", { name: "提問" }) as HTMLTextAreaElement;
const draft = (text: string) => fireEvent.change(box(), { target: { value: text } });
async function ask(text: string) {
  draft(text);
  await userEvent.click(screen.getByRole("button", { name: "送出" }));
}
const errorResponse = (status: number, headers: Record<string, string> = {}) =>
  new Response("{}", { status, headers });

beforeEach(() => {
  writeAck();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("AskChat: frame", () => {
  it("has a title, a data button and a new-chat button", async () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(screen.getByRole("heading", { level: 1, name: "問問看" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新對話" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    expect(screen.getByRole("dialog", { name: "我的資料" })).toBeTruthy();
  });

  it("keeps the composer above the fixed bottom navigation", () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    const composer = box().closest("[data-slot='ask-composer']");
    expect(composer?.className).toContain("sticky");
    // The nav is h-16 plus the safe-area inset; from md up there is no bottom nav.
    expect(composer?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(composer?.className).toContain("md:bottom-0");
  });

  it("keeps one centered reading column no wider than 42rem", () => {
    const { container } = mount(fakeFetch(() => answer("x")).fetchImpl);
    const column = container.querySelector("[data-keyline='column']");
    expect(column?.className).toContain("mx-auto");
    expect(column?.className).toContain("max-w-[42rem]");
    // The header, the lens row and the composer are inside it, so they share its edges.
    for (const keyline of ["header", "context", "composer"]) {
      expect(column?.querySelector(`[data-keyline='${keyline}']`)).not.toBeNull();
    }
  });

  it("says before sending what the next question carries, never an amount", async () => {
    writeHoldings([{ symbol: "0050", amount: 5000 }, { symbol: "TSM" }]);
    writeMemory(["不碰槓桿"]);
    mount(fakeFetch(() => answer("x")).fetchImpl);
    const line = await screen.findByText(/下次提問會帶入/);
    expect(line.textContent).toBe("下次提問會帶入：初學者視角 · 2 檔持股 · 1 則記住的事");
    expect(document.body.textContent).not.toContain("5000");
  });

  it("a lens change says it affects only the next question", async () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    const pro = screen.getByRole("button", { name: ASK_COPY.context.lens.pro });
    expect(pro.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(pro);
    expect(pro.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(ASK_COPY.context.lensNote)).toBeTruthy();
  });
});

describe("AskChat: empty chat", () => {
  it("shows the intro and four suggestions, and tapping one sends its exact text", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    expect(screen.getAllByRole("button", { name: /^(現在|市場|「族群」|看看)/ })).toHaveLength(4);
    const question = ASK_COPY.chat.suggestions[1];
    await userEvent.click(screen.getByRole("button", { name: question }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body.messages).toEqual([{ role: "user", content: question }]);
    // Once there is a conversation the suggestions are gone.
    expect(screen.queryByRole("button", { name: question })).toBeNull();
  });
});

describe("AskChat: first-use disclosure", () => {
  beforeEach(() => {
    window.localStorage.removeItem(ACK_KEY);
  });

  it("is shown before the first request, which waits for the click", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    await ask("問題一");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("伺服器不保存對話");
    expect(calls).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "我知道了" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body.messages).toEqual([{ role: "user", content: "問題一" }]);
    expect(window.localStorage.getItem(ACK_KEY)).toContain("true");
    await waitFor(() => expect(document.activeElement).toBe(box()));
  });

  it("is not shown again after agreeing", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    await ask("一");
    await userEvent.click(await screen.findByRole("button", { name: "我知道了" }));
    await screen.findByText(VERDICT);
    await ask("二");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("sends nothing and keeps the draft when closed without agreeing", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    await ask("不要送");
    await userEvent.click(await screen.findByRole("button", { name: "先不要" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toHaveLength(0);
    expect(window.localStorage.getItem(ACK_KEY)).toBeNull();
    expect(box().value).toBe("不要送");
    // Asking again brings the dialog back.
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("also guards a tapped suggestion", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.chat.suggestions[0] }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("AskChat: answers", () => {
  it("shows the question and the streamed answer, and the fixed sentence once finished", async () => {
    const stream = controlledStream();
    const { fetchImpl } = fakeFetch(() => stream.response);
    mount(fetchImpl);
    await ask("今天如何？");
    expect(screen.getByRole("log").textContent).toContain("今天如何？");
    expect(box().value).toBe("");
    for (const chunk of textChunks("**結論**\n", "偏多。"))
      await act(async () => stream.push(chunk));
    expect(await screen.findByText("偏多。")).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
    await act(async () => {
      stream.push(finishChunk);
      stream.close();
    });
    expect(await screen.findByText(VERDICT)).toBeTruthy();
    expect(screen.getByRole("button", { name: "送出" })).toBeTruthy();
  });

  it("shows the heading of the text after a tool call as a heading, apart from the lead-in", async () => {
    const chunks: StreamChunk[] = [
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "我先查一下今日行情。" },
      { type: "text-end", id: "t1" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "getQuote", input: {} },
      { type: "tool-output-available", toolCallId: "c1", output: {} },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: "**結論**\n偏多。" },
      { type: "text-end", id: "t2" },
      finishChunk,
    ];
    mount(fakeFetch(() => uiStreamResponse(chunks)).fetchImpl);
    await ask("問");
    expect(await screen.findByRole("heading", { level: 2, name: "結論" })).toBeTruthy();
    expect(screen.getByText("我先查一下今日行情。")).toBeTruthy();
  });

  it("marks a broken answer after what was received, with no verdict and no remember card", async () => {
    const chunks: StreamChunk[] = [
      ...textChunks("**結論**\n半句\n要不要我記住：事"),
      { type: "error", errorText: "boom" },
    ];
    mount(fakeFetch(() => uiStreamResponse(chunks)).fetchImpl);
    await ask("問");
    expect(await screen.findByText(ASK_COPY.chat.phase.failed)).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it("retrying a broken answer asks the same question again", async () => {
    const { calls, fetchImpl } = fakeFetch((i) =>
      i === 0
        ? uiStreamResponse([...textChunks("半"), { type: "error", errorText: "x" }])
        : answer("完整"),
    );
    mount(fetchImpl);
    await ask("問");
    await userEvent.click(await screen.findByRole("button", { name: ASK_COPY.chat.retryOriginal }));
    await screen.findByText(VERDICT);
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "問" }]);
  });

  it("offers the current settings as a separate retry only after they changed", async () => {
    const { fetchImpl } = fakeFetch((i) =>
      i === 0
        ? uiStreamResponse([...textChunks("半"), { type: "error", errorText: "x" }])
        : answer("好"),
    );
    mount(fetchImpl);
    await ask("問");
    await screen.findByRole("button", { name: ASK_COPY.chat.retryOriginal });
    expect(screen.queryByRole("button", { name: ASK_COPY.chat.retryCurrent })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.context.lens.pro }));
    expect(screen.getByText(ASK_COPY.chat.retryChanged)).toBeTruthy();
    expect(screen.getByRole("button", { name: ASK_COPY.chat.retryCurrent })).toBeTruthy();
  });

  it("stopping keeps the text without a verdict and puts focus back in the box", async () => {
    const { fetchImpl } = fakeFetch((_i, signal) => controlledStream(signal).response);
    mount(fetchImpl);
    await ask("問");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    await userEvent.click(await screen.findByRole("button", { name: "停止" }));
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(document.activeElement).toBe(box());
  });

  it("offers a remember card for a finished answer; accepting writes exactly one note", async () => {
    const text = "**結論**\n偏多。\n要不要我記住：我是上班族";
    mount(fakeFetch(() => answer(text)).fetchImpl);
    await ask("問");
    expect(await screen.findByText("要記住嗎？『我是上班族』")).toBeTruthy();
    expect(readMemory()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(readMemory()).toEqual(["我是上班族"]);
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
    expect(window.localStorage.getItem(MEMORY_KEY)).toBe('["我是上班族"]');
  });

  it("a second card accepted after the list filled up says the list is full", async () => {
    writeMemory(Array.from({ length: 19 }, (_, i) => `舊的 ${i}`));
    const { fetchImpl } = fakeFetch((i) => answer(`答 ${i}。\n要不要我記住：事 ${i}`));
    mount(fetchImpl);
    await ask("一");
    await screen.findByText("要記住嗎？『事 0』");
    await ask("二");
    await screen.findByText("要記住嗎？『事 1』");
    const [first, second] = screen.getAllByRole("button", { name: "記住" });
    await userEvent.click(first as HTMLElement);
    expect(screen.getByText("已記住")).toBeTruthy();
    await userEvent.click(second as HTMLElement);
    expect(screen.getByText("記住的事已滿，先到我的資料刪掉一則")).toBeTruthy();
    expect(screen.queryByText(/無法儲存/)).toBeNull();
    expect(readMemory()).toHaveLength(20);
  });

  it("offers no card after a reload, but the finished answer keeps its verdict", async () => {
    const text = "**結論**\n偏多。\n要不要我記住：我是上班族";
    const first = mount(fakeFetch(() => answer(text)).fetchImpl);
    await ask("問");
    expect(await screen.findByText("要記住嗎？『我是上班族』")).toBeTruthy();
    first.unmount();
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(await screen.findByText("偏多。")).toBeTruthy();
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
    expect(screen.queryByText(/要不要我記住/)).toBeNull();
    expect(screen.getByText(VERDICT)).toBeTruthy();
    expect(readMemory()).toEqual([]);
  });

  it("dismissing the card writes nothing", async () => {
    mount(fakeFetch(() => answer("答。\n要不要我記住：事")).fetchImpl);
    await ask("問");
    await userEvent.click(await screen.findByRole("button", { name: "不用" }));
    expect(readMemory()).toEqual([]);
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it("opens the term panel from a chip in the beginner lens", async () => {
    mount(fakeFetch(() => answer("今天看族群的表現。")).fetchImpl);
    await ask("問");
    await userEvent.click(await screen.findByRole("button", { name: "族群" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("restores a stored chat", async () => {
    writeChat([
      { role: "user", content: "舊問題" },
      { role: "assistant", content: "舊答案" },
    ]);
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(await screen.findByText("舊答案")).toBeTruthy();
    expect(screen.queryByRole("button", { name: ASK_COPY.chat.suggestions[0] })).toBeNull();
  });

  it("a restored stopped answer has no verdict and no remember card", async () => {
    writeChat([
      { role: "user", content: "問" },
      { role: "assistant", content: "一半\n要不要我記住：事", partial: true },
    ]);
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(await screen.findByText(/一半/)).toBeTruthy();
    // Said in the answer itself, and again by the screen's hidden status line.
    expect(within(screen.getByRole("article")).getByText(ASK_COPY.chat.phase.stopped)).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });
});

describe("AskChat: a question left without an answer", () => {
  it("offers 再問一次 for a restored question with no answer, which asks it once", async () => {
    writeChat([
      { role: "user", content: "舊問題" },
      { role: "assistant", content: "舊答案" },
      { role: "user", content: "沒有答案的問題" },
    ]);
    const { calls, fetchImpl } = fakeFetch(() => answer("終於"));
    mount(fetchImpl);
    await userEvent.click(await screen.findByRole("button", { name: "再問一次" }));
    await screen.findByText("終於");
    expect(calls[0]?.body.messages.at(-1)).toEqual({ role: "user", content: "沒有答案的問題" });
    expect(screen.getAllByText("沒有答案的問題")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "再問一次" })).toBeNull();
  });

  it("offers 再問一次 after a stop before any text", async () => {
    const { calls, fetchImpl } = fakeFetch((i, signal) =>
      i === 0 ? controlledStream(signal).response : answer("好"),
    );
    mount(fetchImpl);
    await ask("問");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
    await userEvent.click(await screen.findByRole("button", { name: "停止" }));
    await userEvent.click(await screen.findByRole("button", { name: "再問一次" }));
    await screen.findByText(VERDICT);
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "問" }]);
  });

  it("offers nothing while offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    writeChat([{ role: "user", content: "沒有答案的問題" }]);
    mount(fakeFetch(() => answer("x")).fetchImpl);
    await screen.findByText("沒有答案的問題");
    expect(screen.queryByRole("button", { name: "再問一次" })).toBeNull();
  });
});

describe("AskChat: new chat", () => {
  it("clears at once when there is nothing to lose", async () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    await userEvent.click(screen.getByRole("button", { name: "新對話" }));
    expect(screen.queryByText(ASK_COPY.chat.newChatConfirm)).toBeNull();
  });

  it("asks first when there are turns, and says what goes and what stays; 取消 keeps them", async () => {
    mount(fakeFetch(() => answer("答案")).fetchImpl);
    await ask("問");
    await screen.findByText("答案");
    await userEvent.click(screen.getByRole("button", { name: "新對話" }));
    const confirm = screen.getByText(ASK_COPY.chat.newChatConfirm);
    expect(confirm.textContent).toContain("無法復原");
    expect(confirm.textContent).toContain("我的資料");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(ASK_COPY.chat.newChatConfirm)).toBeNull();
    expect(screen.getByText("答案")).toBeTruthy();
  });

  it("清除 empties the chat, the stored copy and brings the suggestions back", async () => {
    mount(fakeFetch(() => answer("答案")).fetchImpl);
    await ask("問");
    await screen.findByText("答案");
    expect(window.localStorage.getItem(CHAT_KEY)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "新對話" }));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByText("答案")).toBeNull();
    expect(window.localStorage.getItem(CHAT_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: ASK_COPY.chat.suggestions[0] })).toBeTruthy();
    expect(document.activeElement).toBe(box());
  });
});

describe("AskChat: errors", () => {
  it("429 says how many were used of how many", async () => {
    mount(
      fakeFetch(() => errorResponse(429, { "x-ask-used": "30", "x-ask-limit": "30" })).fetchImpl,
    );
    await ask("問");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "今天的提問次數用完了（30/30），明天再來",
    );
    expect(screen.queryByRole("button", { name: "再試一次" })).toBeNull();
  });

  it("429 without the headers still explains", async () => {
    mount(fakeFetch(() => errorResponse(429)).fetchImpl);
    await ask("問");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "今天的提問次數用完了，明天再來",
    );
  });

  it("503 says the AI is unavailable, and retry sends the same question", async () => {
    const { calls, fetchImpl } = fakeFetch((i) => (i === 0 ? errorResponse(503) : answer("好")));
    mount(fetchImpl);
    await ask("同一題");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "AI 暫時無法回答。如果是我們這邊的問題，這次不會算次數。",
    );
    await userEvent.click(screen.getByRole("button", { name: "再試一次" }));
    await screen.findByText(VERDICT);
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "同一題" }]);
    expect(screen.queryByRole("alert")).toBeNull();
    // The question is not shown twice.
    expect(screen.getAllByText("同一題")).toHaveLength(1);
  });

  it("413 asks for a new chat and offers no retry (the same body would fail again)", async () => {
    mount(fakeFetch(() => errorResponse(413)).fetchImpl);
    await ask("問");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "對話太長，請按「新對話」後再問",
    );
    expect(screen.queryByRole("button", { name: "再試一次" })).toBeNull();
  });

  it("other statuses say something went wrong", async () => {
    mount(fakeFetch(() => errorResponse(500)).fetchImpl);
    await ask("問");
    expect((await screen.findByRole("alert")).textContent).toContain("發生錯誤，請稍後再試");
  });

  it("a dropped connection while offline says a connection is needed", async () => {
    mount(
      fakeFetch(() => {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
        throw new TypeError("network");
      }).fetchImpl,
    );
    await ask("問");
    // Said once, by the composer, while offline: no second copy from the error.
    await waitFor(() =>
      expect(screen.getAllByText(ASK_COPY.composer.offlineReason)).toHaveLength(1),
    );
    expect(screen.queryByText(ASK_COPY.errors.offline)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Back online without sending: the error (and its retry) come back.
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect((await screen.findByRole("alert")).textContent).toContain("需要連線才能提問");
    expect(screen.getByRole("button", { name: "再試一次" })).toBeTruthy();
  });

  it("401 hands back to the invite screen with the question that got no answer", async () => {
    const { onSignedOut } = mount(fakeFetch(() => errorResponse(401)).fetchImpl);
    await ask("問");
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledExactlyOnceWith("問"));
  });

  it("starts with the draft it is given (the question a sign-out left behind)", () => {
    mount(fakeFetch(() => answer("x")).fetchImpl, { initialDraft: "沒問完的問題" });
    expect(box().value).toBe("沒問完的問題");
  });

  it("clears the error when the next question goes out", async () => {
    const { fetchImpl } = fakeFetch((i) => (i === 0 ? errorResponse(500) : answer("好")));
    mount(fetchImpl);
    await ask("一");
    await screen.findByRole("alert");
    await ask("二");
    await screen.findByText(VERDICT);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AskChat: offline", () => {
  it("lets the draft be written, disables Send and says why", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(box().disabled).toBe(false);
    draft("離線時寫的");
    expect(box().value).toBe("離線時寫的");
    expect((screen.getByRole("button", { name: "送出" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(ASK_COPY.composer.offlineReason)).toBeTruthy();
    // The suggestions cannot send either.
    for (const question of ASK_COPY.chat.suggestions) {
      expect((screen.getByRole("button", { name: question }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });
});

describe("AskChat: 我的資料 sheet", () => {
  it("opens from the header button, closes on Escape and gives focus back to the button", async () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    const button = screen.getByRole("button", { name: "我的資料" });
    await userEvent.click(button);
    expect(screen.getByRole("dialog", { name: "我的資料" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("sends exactly what the summary said, and nothing it did not", async () => {
    writeHoldings([{ symbol: "0050", amount: 5000 }, { symbol: "TSM" }]);
    writeMemory(["不碰槓桿"]);
    const { calls, fetchImpl } = fakeFetch(() => answer("ok"));
    mount(fetchImpl);
    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    expect(screen.getByTestId("ask-data-summary").textContent).toBe(
      "下次提問會送出你的問題和這段對話最近的內容，加上：2 檔持股、1 則記住的事",
    );
    await userEvent.keyboard("{Escape}");
    await ask("hi");
    const sent = calls[0]?.body as unknown as { profile: Record<string, unknown[]> };
    const profile = sent.profile;
    expect(profile.plan).toBeUndefined();
    expect(profile.holdings).toEqual([{ symbol: "0050", amount: 5000 }, { symbol: "TSM" }]);
    expect(profile.memory).toEqual(["不碰槓桿"]);
  });

  it("clear-all empties the visible chat and the stored data without a second confirm", async () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    writeHoldings([{ symbol: "AA" }]);
    writeMemory(["m"]);
    writeItem(DRAFT_KEY, "keep me");
    const { fetchImpl } = fakeFetch(() => answer("答案一"));
    mount(fetchImpl);
    await ask("第一個問題");
    expect(await screen.findByText("答案一")).toBeTruthy();
    expect(window.localStorage.getItem(CHAT_KEY)).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    await userEvent.click(screen.getByRole("button", { name: "清除問問看的所有資料" }));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.queryByText("答案一")).toBeNull();
    expect(screen.queryByText("第一個問題")).toBeNull();
    expect(screen.getByText("現在市場發生什麼事？我還會賺錢嗎？")).toBeTruthy();
    expect(keysWithPrefix("muggle.ask.")).toEqual([]);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe("keep me");
    expect(confirm).not.toHaveBeenCalled();
    // The first-use disclosure was part of what was cleared.
    await userEvent.keyboard("{Escape}");
    draft("再問");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(await screen.findByRole("dialog", { name: "送出前請先知道" })).toBeTruthy();
  });
});

describe("AskChat: the draft", () => {
  it("keeps a draft across a reload and sends nothing by itself", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("x"));
    const first = mount(fetchImpl);
    draft("寫到一半");
    first.unmount();
    expect(readDraft()).toBe("寫到一半");
    mount(fetchImpl);
    await waitFor(() => expect(box().value).toBe("寫到一半"));
    expect(calls).toHaveLength(0);
  });

  it("is dropped from the device once the question is really sent", async () => {
    const { fetchImpl } = fakeFetch(() => answer("好"));
    const view = mount(fetchImpl);
    await ask("送出的問題");
    await screen.findByText(VERDICT);
    view.unmount();
    expect(readDraft()).toBe("");
  });

  it("a draft written offline stays in the box after reconnecting and is not sent", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const { calls, fetchImpl } = fakeFetch(() => answer("x"));
    mount(fetchImpl);
    draft("離線時寫的");
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(calls).toHaveLength(0);
    expect(box().value).toBe("離線時寫的");
    expect((screen.getByRole("button", { name: "送出" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("is removed by clear-all together with the rest of the device data", async () => {
    writeDraft("沒送出的草稿");
    mount(fakeFetch(() => answer("x")).fetchImpl);
    await waitFor(() => expect(box().value).toBe("沒送出的草稿"));
    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    await userEvent.click(screen.getByRole("button", { name: "清除問問看的所有資料" }));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(keysWithPrefix("muggle.ask.")).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(box().value).toBe("");
  });

  it("says so when the device refuses the draft, and never calls it saved", async () => {
    const refuse = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      mount(fakeFetch(() => answer("x")).fetchImpl);
      draft("存不下的草稿");
      expect(await screen.findByText(ASK_COPY.composer.draftFailed)).toBeTruthy();
      expect(screen.queryByText(ASK_COPY.composer.draftKept)).toBeNull();
    } finally {
      // The spy sits on the shared localStorage object: restored by hand.
      refuse.mockRestore();
    }
  });
});

describe("AskChat: editing and following up", () => {
  it("editing the last question replaces it and its answer", async () => {
    const { calls, fetchImpl } = fakeFetch((i) => answer(i === 0 ? "舊答案" : "新答案"));
    mount(fetchImpl);
    await ask("舊問題");
    await screen.findByText("舊答案");
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.chat.editQuestion }));
    expect(box().value).toBe("舊問題");
    expect(screen.getByText(ASK_COPY.composer.editing)).toBeTruthy();
    draft("新問題");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    await screen.findByText("新答案");
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "新問題" }]);
    expect(screen.queryByText("舊問題")).toBeNull();
    expect(screen.queryByText("舊答案")).toBeNull();
    expect(screen.queryByText(ASK_COPY.composer.editing)).toBeNull();
  });

  it("cancelling an edit puts back what the box held and keeps the answer", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("答案"));
    mount(fetchImpl);
    await ask("問題");
    await screen.findByText("答案");
    draft("另一個還沒寫完的");
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.chat.editQuestion }));
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.composer.cancelEdit }));
    expect(box().value).toBe("另一個還沒寫完的");
    expect(screen.getByText("答案")).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("follow-up chips only fill the box; nothing is sent until Send", async () => {
    const { calls, fetchImpl } = fakeFetch(() => answer("好"));
    mount(fetchImpl);
    await ask("問題");
    await screen.findByText(VERDICT);
    const question = ASK_COPY.chat.followUps.items[0];
    await userEvent.click(screen.getByRole("button", { name: question }));
    expect(box().value).toBe(question);
    expect(calls).toHaveLength(1);
    expect(document.activeElement).toBe(box());
  });

  it("offers no follow-ups after an answer that did not finish", async () => {
    const { fetchImpl } = fakeFetch(() =>
      uiStreamResponse([...textChunks("半"), { type: "error", errorText: "x" }]),
    );
    mount(fetchImpl);
    await ask("問題");
    await screen.findByText(ASK_COPY.chat.phase.failed);
    expect(screen.queryByText(ASK_COPY.chat.followUps.label)).toBeNull();
  });
});
