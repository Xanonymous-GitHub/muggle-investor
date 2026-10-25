import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { AssistantMessage, UserMessage } from "./assistant-message";
import { MEMORY_KEY, writeMemory } from "./stores";
import { makeRecord, makeTurn, makeVerification } from "./turn-fixture";
import type { Turn } from "./use-ask-chat";

// Counts how often an answer's Markdown is rendered; it still renders exactly as before.
const markdownRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("react-markdown", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-markdown")>();
  const Counted = (props: Parameters<typeof original.default>[0]) => {
    markdownRenders.count += 1;
    return original.default(props);
  };
  return { ...original, default: Counted };
});

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

const VERDICT = "這是 AI 的觀點，不是保證，也不構成投資建議。";

function renderTurn(
  patch: Partial<Turn> = {},
  props: Partial<React.ComponentProps<typeof AssistantMessage>> = {},
) {
  const onRemember = props.onRemember ?? vi.fn(() => "saved" as const);
  const onInspect = props.onInspect ?? vi.fn();
  const view = render(
    <AssistantMessage
      turn={makeTurn(patch)}
      lens="pro"
      terms={GLOSSARY}
      onOpenTerm={() => {}}
      onRemember={onRemember}
      onInspect={onInspect}
      {...props}
    />,
  );
  return { ...view, onRemember, onInspect };
}

describe("AssistantMessage: frame", () => {
  it("labels the answer 'AI 分析師' and renders it with the answer view", () => {
    renderTurn();
    expect(screen.getByText("AI 分析師")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "結論" })).toBeTruthy();
    expect(screen.getByText("偏多。")).toBeTruthy();
  });

  it("shows a waiting placeholder before the first text", () => {
    renderTurn({ text: "", streaming: true });
    expect(screen.getByText("AI 分析師正在回答")).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
  });

  it("the waiting placeholder does not pulse when reduced motion is asked for", () => {
    const { container } = renderTurn({ text: "", streaming: true });
    const skeletons = container.querySelectorAll("[data-slot='skeleton']");
    expect(skeletons).toHaveLength(2);
    for (const skeleton of skeletons) {
      expect(skeleton.className).toContain("motion-reduce:animate-none");
    }
  });

  it("does not render an unchanged answer's text again when the message re-renders", () => {
    const turn = makeTurn({ text: "**結論**\n偏多。", verification: null });
    const onOpenTerm = () => {};
    const props = {
      lens: "pro" as const,
      terms: GLOSSARY,
      onOpenTerm,
      onRemember: () => "saved" as const,
      onInspect: () => {},
    };
    const { rerender } = render(<AssistantMessage turn={turn} {...props} />);
    const before = markdownRenders.count;
    // A chunk for another turn: the list re-renders every message with the same turn object.
    rerender(<AssistantMessage turn={turn} {...props} />);
    rerender(<AssistantMessage turn={{ ...turn }} {...props} />);
    expect(markdownRenders.count).toBe(before);
  });

  it("says which lens and which personal context the answer was asked with", () => {
    renderTurn({
      lens: "beginner",
      context: { plan: true, holdings: 2, memory: 3 },
    });
    expect(screen.getByText(/初學者視角/)).toBeTruthy();
    expect(screen.getByText(/送出時帶入：規劃答案 · 2 檔持股 · 3 則記住的事/)).toBeTruthy();
  });

  it("says nothing was brought in when the context was empty, and nothing when it is unknown", () => {
    const { unmount } = renderTurn({
      lens: "pro",
      context: { plan: false, holdings: 0, memory: 0 },
    });
    expect(screen.getByText(/送出時沒有帶入個人資料/)).toBeTruthy();
    unmount();
    renderTurn({ lens: null, context: null });
    expect(screen.queryByText(/送出時/)).toBeNull();
    expect(screen.queryByText(/視角/)).toBeNull();
  });

  it("never shows the amounts: only counts of what was brought in", () => {
    const { container } = renderTurn({ context: { plan: false, holdings: 1, memory: 0 } });
    expect(container.textContent).not.toMatch(/\d{4,}/);
  });
});

describe("AssistantMessage: notices", () => {
  it.each([
    ["no_web", "這次沒有查網路"],
    ["no_tools", "這次沒有使用任何工具"],
    ["tool_failed", "部分外部工具無法使用"],
    ["timeout", "回答時間過長，已先停在這裡"],
    ["limited", "這次查資料已達上限"],
    ["trimmed", "較早的部分沒有納入"],
    ["declined", "這次沒有回答：超出投資與理財的範圍"],
    ["withheld", "回答偏離了投資與理財的範圍，已先停在這裡"],
  ] as const)("shows the %s banner with the server's text as a status", (kind, text) => {
    renderTurn({ notices: [{ kind, text }] });
    expect(screen.getByRole("status").textContent).toContain(text);
  });

  it("shows several banners", () => {
    renderTurn({
      notices: [
        { kind: "no_web", text: "這次沒有查網路" },
        { kind: "tool_failed", text: "部分外部工具無法使用" },
      ],
    });
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});

describe("AssistantMessage: what was looked up", () => {
  it("says what is being looked up while a tool runs, naming the external server", () => {
    renderTurn({
      streaming: true,
      text: "",
      tools: [
        { callId: "a", name: "getMarketToday", state: "succeeded" },
        { callId: "b", name: "search__web_search", state: "running" },
        { callId: "c", name: "getSectorBoard", state: "running" },
      ],
    });
    expect(screen.getByText("正在查：外部查詢（search）、族群")).toBeTruthy();
  });

  it("collapses to one count line when the calls are done, with each call behind it", async () => {
    renderTurn({
      tools: [
        { callId: "a", name: "getMarketToday", state: "succeeded" },
        { callId: "b", name: "search__web_search", state: "succeeded" },
        { callId: "c", name: "search__fetch", state: "succeeded" },
      ],
    });
    expect(screen.getByText("查了 3 項資料")).toBeTruthy();
    expect(screen.queryByText(/正在查/)).toBeNull();
    const list = screen.getByText("今日行情").closest("ul");
    expect(within(list as HTMLElement).getAllByText("已回傳")).toHaveLength(3);
    expect(within(list as HTMLElement).getByText(/只代表工具有回應/)).toBeTruthy();
  });

  it("tells a failed and a denied call from a successful one, in the summary and the list", () => {
    renderTurn({
      tools: [
        { callId: "a", name: "getMarketToday", state: "succeeded" },
        { callId: "b", name: "search__web_search", state: "failed" },
        { callId: "c", name: "getMyPlan", state: "denied" },
      ],
    });
    expect(screen.getByText("查了 3 項資料 · 1 項沒成功 · 1 項被拒絕")).toBeTruthy();
    expect(screen.getByText("失敗")).toBeTruthy();
    expect(screen.getByText("被拒絕")).toBeTruthy();
  });

  it("shows nothing for an answer without tools", () => {
    renderTurn();
    expect(screen.queryByText(/正在查|查了/)).toBeNull();
  });
});

describe("AssistantMessage: how it ended", () => {
  it("shows the fixed sentence once the answer finished", () => {
    renderTurn();
    expect(screen.getByText(VERDICT)).toBeTruthy();
    expect(screen.getByText("回答完成")).toBeTruthy();
  });

  it.each<[string, Partial<Turn>]>([
    ["streaming", { streaming: true }],
    ["failed", { failed: true }],
    ["stopped", { stopped: true }],
    ["timed out", { timedOut: true }],
    ["withheld", { notices: [{ kind: "withheld", text: "已先停在這裡" }] }],
    ["of unknown outcome", { statusUnknown: true }],
    ["empty", { text: "" }],
  ])("does not show it for a %s answer", (_name, patch) => {
    renderTurn(patch);
    expect(screen.queryByText(VERDICT)).toBeNull();
  });

  it("a timeout stays a timeout when a finish followed it", () => {
    renderTurn({
      timedOut: true,
      finishReason: "stop",
      notices: [{ kind: "timeout", text: "回答時間過長，已先停在這裡" }],
    });
    expect(screen.getByText("逾時，內容不完整")).toBeTruthy();
    expect(screen.queryByText("回答完成")).toBeNull();
    expect(screen.queryByText(VERDICT)).toBeNull();
  });

  it("marks a failed answer after the received text and offers to ask again", async () => {
    const run = vi.fn();
    renderTurn(
      {
        failed: true,
        text: "前半段",
        lens: "pro",
        context: { plan: false, holdings: 0, memory: 0 },
      },
      { retry: { hasOriginal: true, changed: false, run } },
    );
    expect(screen.getByText("前半段")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("中斷，內容不完整");
    await userEvent.click(screen.getByRole("button", { name: "沿用原本設定再問一次" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("original");
    expect(screen.queryByRole("button", { name: "改用目前的設定再問" })).toBeNull();
  });

  it("offers a retry for a timed-out answer too, but not for a stopped or withheld one", () => {
    const retry = { hasOriginal: true, changed: false, run: vi.fn() };
    const { unmount } = renderTurn({ timedOut: true }, { retry });
    expect(screen.getByRole("button", { name: "沿用原本設定再問一次" })).toBeTruthy();
    unmount();
    const stopped = renderTurn({ stopped: true }, { retry });
    expect(screen.queryByRole("button", { name: /再問/ })).toBeNull();
    stopped.unmount();
    renderTurn({ notices: [{ kind: "withheld", text: "x" }] }, { retry });
    expect(screen.queryByRole("button", { name: /再問/ })).toBeNull();
  });

  it("says when the settings changed since the question, and offers both ways to ask again", async () => {
    const run = vi.fn();
    renderTurn({ failed: true }, { retry: { hasOriginal: true, changed: true, run } });
    expect(screen.getByText("目前的視角或帶入的資料和這則提問時不同。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "改用目前的設定再問" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("current");
  });

  it("after a reload there is no original: it says the current settings are used", async () => {
    const run = vi.fn();
    renderTurn({ failed: true }, { retry: { hasOriginal: false, changed: false, run } });
    expect(screen.getByText("重新提問會使用目前的視角和資料。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "沿用原本設定再問一次" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "再問一次" }));
    expect(run).toHaveBeenCalledExactlyOnceWith("current");
  });

  it("marks a stopped answer without calling it an error", () => {
    renderTurn({ stopped: true, text: "一半" });
    expect(screen.getByText("已停止，內容不完整")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks a withheld answer, and one kept without a recorded outcome", () => {
    const { unmount } = renderTurn({ notices: [{ kind: "withheld", text: "已先停在這裡" }] });
    expect(screen.getByText("已中止，內容不完整")).toBeTruthy();
    unmount();
    renderTurn({ statusUnknown: true, restored: true });
    expect(screen.getByText("完成狀態未知（舊版存下的回答）")).toBeTruthy();
  });
});

describe("AssistantMessage: waiting", () => {
  it("words a slow wait by elapsed time, and never promises how long is left", () => {
    vi.useFakeTimers();
    const started = Date.now();
    renderTurn({ text: "", streaming: true, startedAt: started });
    expect(screen.queryByText(/還在等待|仍然沒有回應/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(screen.getByText("回應比平常慢，還在等待")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByText("仍然沒有回應，可以繼續等，或按「停止」")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/約|預計|秒後|%/);
  });

  it("counts from when the question went out, not from when the message appeared", () => {
    vi.useFakeTimers();
    renderTurn({ text: "", streaming: true, startedAt: Date.now() - 9_000 });
    expect(screen.getByText("回應比平常慢，還在等待")).toBeTruthy();
  });

  it("drops the wait note once text arrives", () => {
    vi.useFakeTimers();
    const started = Date.now() - 9_000;
    const { rerender } = renderTurn({ text: "", streaming: true, startedAt: started });
    expect(screen.getByText("回應比平常慢，還在等待")).toBeTruthy();
    rerender(
      <AssistantMessage
        turn={makeTurn({ text: "**結論**\n開始了", streaming: true, startedAt: started })}
        lens="pro"
        terms={GLOSSARY}
        onOpenTerm={() => {}}
        onRemember={() => "saved"}
        onInspect={() => {}}
      />,
    );
    expect(screen.queryByText(/還在等待/)).toBeNull();
  });
});

describe("AssistantMessage: sources and the number check", () => {
  it("says when the numbers could not be checked, and lists no sources", () => {
    renderTurn({ verification: { checked: false, unsupported: [] } });
    expect(screen.getByText("這次無法查核回答裡的數字（查核僅供參考）")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /來源/ })).toBeNull();
  });

  it("lists numbers without a source in plain view and marks them in the text", () => {
    const { container } = renderTurn({
      text: "目標價 999 元。",
      verification: { checked: true, unsupported: ["999"] },
    });
    expect(screen.getByText("這些數字沒有對應到資料來源：999（查核僅供參考）")).toBeTruthy();
    expect(container.querySelector("mark")?.textContent).toBe("999");
  });

  it("an empty issue list is not a success claim: without source details it says so", () => {
    renderTurn({ verification: { checked: true, unsupported: [] } });
    expect(screen.getByText("伺服器沒有提供來源明細")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/已驗證|已查證|驗證通過|正確/);
  });

  it("says when no source came back, and what the check does not cover", async () => {
    renderTurn({ verification: makeVerification([]) });
    expect(screen.getByText("沒有查到可核對的資料來源")).toBeTruthy();
    await userEvent.click(screen.getByText(/^查核說明（/));
    expect(
      screen.getByText("這次沒有查到可核對的資料來源，回答裡的數字與說法都沒有經過核對"),
    ).toBeTruthy();
  });

  it("counts sources that returned data, and still says the check is narrow", async () => {
    renderTurn({ verification: makeVerification([makeRecord(), makeRecord({ id: "s2" })]) });
    expect(screen.getByText("2 個來源有回傳資料")).toBeTruthy();
    await userEvent.click(screen.getByText(/^查核說明（/));
    expect(screen.getByText(/不代表說法本身經過查證/)).toBeTruthy();
  });

  it.each([
    ["a failed tool", [makeRecord(), makeRecord({ id: "s2", tool: "search__web", failed: true })]],
    ["truncated data", [makeRecord({ truncated: true })]],
    ["stale data", [makeRecord({ warnings: ["stale"] })]],
    ["intraday data", [makeRecord({ warnings: ["provisional"] })]],
  ])("calls the sources incomplete for %s", (_name, records) => {
    renderTurn({ verification: makeVerification(records) });
    expect(screen.getByText("來源有缺漏，詳見查核說明")).toBeTruthy();
  });

  it("names the server of a failed external tool in the notes, not the tool's own id", async () => {
    renderTurn({
      verification: makeVerification([
        makeRecord(),
        makeRecord({ id: "s2", tool: "search__web_search", kind: "external", failed: true }),
      ]),
    });
    await userEvent.click(screen.getByText(/^查核說明（/));
    expect(screen.getByText("這些工具這次沒有查到資料：外部查詢（search）")).toBeTruthy();
    expect(document.body.textContent).not.toContain("web_search");
  });

  it("an answer that ended without a check says so, separately from how it ended", () => {
    renderTurn({ stopped: true, verification: null });
    expect(screen.getByText("已停止，內容不完整")).toBeTruthy();
    expect(screen.getByText("這次沒有收到來源核對結果")).toBeTruthy();
  });

  it("a complete answer can have no source, and a timed-out one can have sources: two statuses", () => {
    const none = renderTurn({ verification: makeVerification([]) });
    expect(screen.getByText("回答完成")).toBeTruthy();
    expect(screen.getByText("沒有查到可核對的資料來源")).toBeTruthy();
    none.unmount();
    renderTurn({ timedOut: true, verification: makeVerification([makeRecord()]) });
    expect(screen.getByText("逾時，內容不完整")).toBeTruthy();
    expect(screen.getByText("1 個來源有回傳資料")).toBeTruthy();
  });

  it("has one button per source that opens it, by pointer and by keyboard", async () => {
    const { onInspect } = renderTurn({
      id: "turn-9",
      verification: makeVerification([
        makeRecord(),
        makeRecord({ id: "s2", tool: "search__web", kind: "external", failed: true }),
      ]),
    });
    const first = screen.getByRole("button", { name: "來源 1：今日行情" });
    const second = screen.getByRole("button", { name: /來源 2：外部查詢（search）/ });
    expect(second.textContent).toContain("沒有查到資料");
    await userEvent.click(first);
    expect(onInspect).toHaveBeenLastCalledWith("turn-9", "s1");
    second.focus();
    await userEvent.keyboard("{Enter}");
    expect(onInspect).toHaveBeenLastCalledWith("turn-9", "s2");
    await userEvent.keyboard(" ");
    expect(onInspect).toHaveBeenCalledTimes(3);
  });

  it("marks the chip of the open source, and says how many sources were left out", () => {
    renderTurn(
      { id: "t7", verification: makeVerification([makeRecord()], { omitted: 4 }) },
      { inspectedId: "t7:s1" },
    );
    expect(
      screen.getByRole("button", { name: "來源 1：今日行情" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("另有 4 筆未列出")).toBeTruthy();
  });

  it("shows no sources section while the answer streams and its check has not come", () => {
    const { container } = renderTurn({ streaming: true, text: "寫到一半" });
    expect(container.querySelector("section[aria-label='來源與查核']")).toBeNull();
  });
});

describe("AssistantMessage: remember card", () => {
  const withFact = "**結論**\n偏多。\n要不要我記住：我每月定期定額一萬元";

  it("shows the card for a valid last line and keeps the line out of the body", () => {
    renderTurn({ text: withFact });
    expect(screen.getByText("要記住嗎？『我每月定期定額一萬元』")).toBeTruthy();
    expect(screen.queryByText(/要不要我記住/)).toBeNull();
  });

  it("does not write anything by rendering", () => {
    const { onRemember } = renderTurn({ text: withFact });
    expect(onRemember).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(MEMORY_KEY)).toBeNull();
  });

  it.each([
    ["bold", "答案。\n**要不要我記住：事**"],
    ["ASCII colon", "答案。\n要不要我記住:事"],
    ["not last", "答案。\n要不要我記住：事\n後面還有字"],
    ["quoted", "答案。\n> 要不要我記住：事"],
    ["empty fact", "答案。\n要不要我記住："],
  ])("does not show the card for a lookalike (%s)", (_name, text) => {
    renderTurn({ text });
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it.each([
    ["streaming", { streaming: true }],
    ["failed", { failed: true }],
    ["stopped", { stopped: true }],
    ["timed out", { timedOut: true }],
  ] as const)("does not show the card for a %s answer", (_name, patch) => {
    renderTurn({ text: withFact, ...patch });
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it.each([
    ["stopped", { stopped: true }],
    ["failed", { failed: true }],
  ] as const)("leaves the remember line out of a %s answer's body too", (_name, patch) => {
    const { container } = renderTurn({ text: withFact, ...patch });
    expect(screen.getByText("偏多。")).toBeTruthy();
    expect(container.textContent).not.toContain("要不要我記住");
    expect(container.textContent).not.toContain("我每月定期定額一萬元");
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it("offers no card for a restored answer but keeps its verdict and hides the line", () => {
    const { container } = renderTurn({ text: withFact, restored: true });
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
    expect(container.textContent).not.toContain("要不要我記住");
    expect(screen.getByText(VERDICT)).toBeTruthy();
  });

  it("accepting calls onRemember once with the fact and hides the card", async () => {
    const { onRemember } = renderTurn({ text: withFact });
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(onRemember).toHaveBeenCalledExactlyOnceWith("我每月定期定額一萬元");
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
    expect(screen.getByText("已記住")).toBeTruthy();
  });

  it("saves the note as corrected, not as the model wrote it", async () => {
    const { onRemember } = renderTurn({ text: withFact });
    await userEvent.click(screen.getByRole("button", { name: "修改" }));
    const box = screen.getByRole("textbox", { name: "修改要記住的內容" });
    await userEvent.clear(box);
    await userEvent.type(box, "我每月定期定額五千元");
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(onRemember).toHaveBeenCalledExactlyOnceWith("我每月定期定額五千元");
  });

  it("says so when the note could not be saved, and never says it was saved", async () => {
    renderTurn({ text: withFact }, { onRemember: () => "failed" });
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(screen.getByText("無法儲存，這台裝置的儲存空間可能不可用")).toBeTruthy();
    expect(screen.queryByText("已記住")).toBeNull();
  });

  it("says the list is full, not that storage failed, when it filled up meanwhile", async () => {
    renderTurn({ text: withFact }, { onRemember: () => "full" });
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(screen.getByText("記住的事已滿，先到我的資料刪掉一則")).toBeTruthy();
    expect(screen.queryByText(/無法儲存/)).toBeNull();
  });

  it("dismissing writes nothing and hides the card", async () => {
    const { onRemember } = renderTurn({ text: withFact });
    await userEvent.click(screen.getByRole("button", { name: "不用" }));
    expect(onRemember).not.toHaveBeenCalled();
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
    expect(screen.queryByText("已記住")).toBeNull();
  });

  it("does not ask again for a fact that is already saved", () => {
    writeMemory(["我每月定期定額一萬元"]);
    renderTurn({ text: withFact });
    expect(screen.queryByText(/要記住嗎/)).toBeNull();
  });

  it("with 20 notes saved explains instead of offering to save", () => {
    writeMemory(Array.from({ length: 20 }, (_, i) => `事${i}`));
    renderTurn({ text: withFact });
    expect(screen.getByText("記住的事已滿，先到我的資料刪掉一則")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記住" })).toBeNull();
  });
});

describe("AssistantMessage: term chips", () => {
  it("opens a term from a chip in the beginner lens only", async () => {
    const onOpenTerm = vi.fn();
    const { unmount } = renderTurn(
      { text: "今天看族群的表現。" },
      { lens: "beginner", onOpenTerm },
    );
    await userEvent.click(screen.getByRole("button", { name: "族群" }));
    expect(onOpenTerm).toHaveBeenCalledWith("sector");
    unmount();
    renderTurn({ text: "今天看族群的表現。" }, { lens: "pro" });
    expect(screen.queryByRole("button", { name: "族群" })).toBeNull();
  });
});

describe("UserMessage", () => {
  it("shows the question as plain text in a bubble", () => {
    const { container } = render(
      <UserMessage turn={{ ...makeTurn(), role: "user", text: "**不是粗體** <b>x</b>" }} />,
    );
    expect(within(container).getByText("**不是粗體** <b>x</b>")).toBeTruthy();
    expect(container.querySelector("strong, b")).toBeNull();
  });
});
