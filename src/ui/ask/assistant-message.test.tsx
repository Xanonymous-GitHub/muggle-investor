import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { AssistantMessage, UserMessage } from "./assistant-message";
import { MEMORY_KEY, writeMemory } from "./stores";
import type { Turn } from "./use-ask-chat";

afterEach(() => {
  window.localStorage.clear();
});

const VERDICT = "這是 AI 的觀點，不是保證，也不構成投資建議。";

const assistant = (patch: Partial<Turn> = {}): Turn => ({
  id: "t1",
  role: "assistant",
  text: "**結論**\n偏多。",
  notices: [],
  verification: null,
  tools: [],
  streaming: false,
  failed: false,
  stopped: false,
  ...patch,
});

function renderTurn(
  patch: Partial<Turn> = {},
  props: Partial<React.ComponentProps<typeof AssistantMessage>> = {},
) {
  const onRemember = props.onRemember ?? vi.fn(() => true);
  const view = render(
    <AssistantMessage
      turn={assistant(patch)}
      lens="pro"
      terms={GLOSSARY}
      onOpenTerm={() => {}}
      onRemember={onRemember}
      {...props}
    />,
  );
  return { ...view, onRemember };
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
});

describe("AssistantMessage: notices", () => {
  it.each([
    ["no_web", "這次沒有查網路"],
    ["no_tools", "這次沒有使用任何工具"],
    ["tool_failed", "部分外部工具無法使用"],
    ["timeout", "回答時間過長，已先停在這裡"],
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

describe("AssistantMessage: tools", () => {
  it("says what is being looked up while a tool runs", () => {
    renderTurn({
      streaming: true,
      text: "",
      tools: [
        { name: "getMarketToday", done: true },
        { name: "mcp__search__web", done: false },
        { name: "search_x", done: false },
      ],
    });
    expect(screen.getByText("正在查 查網路")).toBeTruthy();
  });

  it("names a running built-in tool in Chinese", () => {
    renderTurn({ streaming: true, text: "", tools: [{ name: "getSectorBoard", done: false }] });
    expect(screen.getByText("正在查 族群")).toBeTruthy();
  });

  it("collapses to one 用了 line, each name once, when the calls are done", () => {
    renderTurn({
      tools: [
        { name: "getMarketToday", done: true },
        { name: "mcp__a__b", done: true },
        { name: "mcp__c__d", done: true },
      ],
    });
    expect(screen.getByText("用了：今日行情、查網路")).toBeTruthy();
    expect(screen.queryByText(/正在查/)).toBeNull();
  });

  it("shows nothing for an answer without tools", () => {
    renderTurn();
    expect(screen.queryByText(/正在查|用了/)).toBeNull();
  });
});

describe("AssistantMessage: finished or not", () => {
  it("shows the fixed sentence once the answer finished", () => {
    renderTurn();
    expect(screen.getByText(VERDICT)).toBeTruthy();
  });

  it.each([
    ["streaming", { streaming: true }],
    ["failed", { failed: true }],
    ["stopped", { stopped: true }],
    ["empty", { text: "" }],
  ] as const)("does not show it for a %s answer", (_name, patch) => {
    renderTurn(patch);
    expect(screen.queryByText(VERDICT)).toBeNull();
  });

  it("marks a failed answer after the received text and offers a retry", async () => {
    const onRetry = vi.fn();
    renderTurn({ failed: true, text: "前半段" }, { onRetry });
    expect(screen.getByText("前半段")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("回答中斷了，可以再問一次");
    await userEvent.click(screen.getByRole("button", { name: "再問一次" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("marks a stopped answer without calling it an error", () => {
    renderTurn({ stopped: true, text: "一半" });
    expect(screen.getByText("已停止回答")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("AssistantMessage: verification", () => {
  it("says when the numbers could not be checked", () => {
    renderTurn({ verification: { checked: false, unsupported: [] } });
    expect(screen.getByText("這次無法查核回答裡的數字（查核僅供參考）")).toBeTruthy();
  });

  it("lists numbers without a source and marks them in the text", () => {
    const { container } = renderTurn({
      text: "目標價 999 元。",
      verification: { checked: true, unsupported: ["999"] },
    });
    expect(screen.getByText("這些數字沒有對應到資料來源：999（查核僅供參考）")).toBeTruthy();
    expect(container.querySelector("mark")?.textContent).toBe("999");
  });

  it("says nothing when everything checked out", () => {
    renderTurn({ verification: { checked: true, unsupported: [] } });
    expect(screen.queryByText(/查核/)).toBeNull();
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

  it("says so when the note could not be saved", async () => {
    renderTurn({ text: withFact }, { onRemember: () => false });
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(screen.getByText("無法儲存，這台裝置的儲存空間可能不可用")).toBeTruthy();
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
      <UserMessage turn={{ ...assistant(), role: "user", text: "**不是粗體** <b>x</b>" }} />,
    );
    expect(within(container).getByText("**不是粗體** <b>x</b>")).toBeTruthy();
    expect(container.querySelector("strong, b")).toBeNull();
  });
});
