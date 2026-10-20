import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { AskChat } from "./ask-chat";
import { ASK_COPY } from "./copy";
import { ACK_KEY, CHAT_KEY, MEMORY_KEY, readMemory, writeAck, writeChat } from "./stores";
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
  props: { onOpenData?: () => void; onSignedOut?: () => void } = {},
) {
  const onOpenData = props.onOpenData ?? vi.fn();
  const onSignedOut = props.onSignedOut ?? vi.fn();
  const wrap = (node: ReactNode) => <SettingsProvider>{node}</SettingsProvider>;
  const view = render(
    wrap(<AskChat fetchImpl={fetchImpl} onOpenData={onOpenData} onSignedOut={onSignedOut} />),
  );
  return { ...view, onOpenData, onSignedOut };
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
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("AskChat: frame", () => {
  it("has a title, a data button and a new-chat button", async () => {
    const { onOpenData } = mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(screen.getByRole("heading", { level: 1, name: "問問看" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    expect(onOpenData).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "新對話" })).toBeTruthy();
  });

  it("keeps the composer above the fixed bottom navigation", () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    const composer = box().closest("[data-slot='ask-composer']");
    expect(composer?.className).toContain("sticky");
    // The nav is h-16 plus the safe-area inset; from md up there is no bottom nav.
    expect(composer?.className).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(composer?.className).toContain("md:bottom-0");
  });

  it("is centered and no wider than max-w-3xl", () => {
    const { container } = mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(container.querySelector("[data-testid='ask-chat']")?.className).toContain("max-w-3xl");
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

  it("marks a broken answer after what was received, with no verdict and no remember card", async () => {
    const chunks: StreamChunk[] = [
      ...textChunks("**結論**\n半句\n要不要我記住：事"),
      { type: "error", errorText: "boom" },
    ];
    mount(fakeFetch(() => uiStreamResponse(chunks)).fetchImpl);
    await ask("問");
    expect(await screen.findByText("回答中斷了，可以再問一次")).toBeTruthy();
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
    await userEvent.click(await screen.findByRole("button", { name: "再問一次" }));
    await screen.findByText(VERDICT);
    expect(calls[1]?.body.messages).toEqual([{ role: "user", content: "問" }]);
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
    expect(screen.getByText("已停止回答")).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });
});

describe("AskChat: new chat", () => {
  it("clears at once when there is nothing to lose", async () => {
    mount(fakeFetch(() => answer("x")).fetchImpl);
    await userEvent.click(screen.getByRole("button", { name: "新對話" }));
    expect(screen.queryByText("要清除這段對話嗎？清除後無法復原。")).toBeNull();
  });

  it("asks first when there are turns; 取消 keeps them", async () => {
    mount(fakeFetch(() => answer("答案")).fetchImpl);
    await ask("問");
    await screen.findByText("答案");
    await userEvent.click(screen.getByRole("button", { name: "新對話" }));
    expect(screen.getByText("要清除這段對話嗎？清除後無法復原。")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("要清除這段對話嗎？清除後無法復原。")).toBeNull();
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

  it("413 asks to send again", async () => {
    mount(fakeFetch(() => errorResponse(413)).fetchImpl);
    await ask("問");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "對話太長，已自動縮短，請再送一次",
    );
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
    await waitFor(() => expect(screen.getAllByText("需要連線才能提問").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("alert")[0]?.textContent).toContain("需要連線才能提問");
  });

  it("401 hands back to the invite screen", async () => {
    const { onSignedOut } = mount(fakeFetch(() => errorResponse(401)).fetchImpl);
    await ask("問");
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
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
  it("disables the composer and says a connection is needed", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    mount(fakeFetch(() => answer("x")).fetchImpl);
    expect(box().disabled).toBe(true);
    expect(screen.getByText("需要連線才能提問")).toBeTruthy();
    // The suggestions cannot send either.
    for (const question of ASK_COPY.chat.suggestions) {
      expect((screen.getByRole("button", { name: question }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });
});
