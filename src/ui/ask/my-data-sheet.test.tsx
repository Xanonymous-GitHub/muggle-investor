import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { keysWithPrefix, writeItem } from "@/ui/device/storage";
import { DRAFT_KEY, type PlanDraft, serializeDraft } from "@/ui/plan/draft";
import { matchEveryQuery } from "@/ui/test/match-media";
import { MyDataSheet } from "./my-data-sheet";
import { buildAskBody, currentPlanRequest, describeOutgoing } from "./request";
import {
  ACK_KEY,
  CHAT_KEY,
  HOLDINGS_KEY,
  MEMORY_KEY,
  PROFILE_KEY,
  readHoldings,
  readMemory,
  readPlanOptIn,
  writeAck,
  writeChat,
  writeHoldings,
  writeMemory,
  writePlanOptIn,
} from "./stores";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const FULL_DRAFT: PlanDraft = {
  answers: Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0]?.id ?? ""])),
  amounts: {
    lump: "600,000",
    monthly: "15000",
    monthlyExpenses: "30,000",
    existingReserve: "90000",
  },
};
const saveDraft = (draft: PlanDraft = FULL_DRAFT) => writeItem(DRAFT_KEY, serializeDraft(draft));

/** A host with a trigger button, like the chat header's. */
function Host({
  onCleared = () => {},
  withRef = true,
}: {
  onCleared?: () => void;
  withRef?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        開啟
      </button>
      <MyDataSheet
        open={open}
        onOpenChange={setOpen}
        onCleared={onCleared}
        triggerRef={withRef ? triggerRef : undefined}
      />
    </>
  );
}

async function openSheet(onCleared?: () => void, withRef = true) {
  render(<Host onCleared={onCleared} withRef={withRef} />);
  await userEvent.click(screen.getByRole("button", { name: "開啟" }));
  return screen.getByRole("dialog");
}

const planSwitch = () => screen.getByRole("switch", { name: "提問時帶入我的規劃答案" });
const summary = () => screen.getByTestId("ask-data-summary").textContent;

describe("MyDataSheet: plan opt-in", () => {
  it("is off by default and disabled with the reason while the questionnaire is incomplete", async () => {
    await openSheet();
    expect(planSwitch().getAttribute("aria-checked")).toBe("false");
    expect((planSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("先到規劃頁填完問卷")).toBeTruthy();
    await userEvent.click(planSwitch());
    expect(readPlanOptIn()).toBe(false);
  });

  it("is off by default with a complete draft, turns on and persists", async () => {
    saveDraft();
    await openSheet();
    expect(planSwitch().getAttribute("aria-checked")).toBe("false");
    expect((planSwitch() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("先到規劃頁填完問卷")).toBeNull();
    expect(screen.queryByText(/問卷答案與金額會一併送出/)).toBeNull();
    await userEvent.click(planSwitch());
    expect(planSwitch().getAttribute("aria-checked")).toBe("true");
    expect(readPlanOptIn()).toBe(true);
    expect(screen.getByText("已開啟：問卷答案與金額會一併送出。")).toBeTruthy();
    await userEvent.click(planSwitch());
    expect(readPlanOptIn()).toBe(false);
  });

  it("shows the sent-note only when the opt-in is on and the draft is complete", async () => {
    writePlanOptIn(true);
    await openSheet();
    // On, but no complete draft: nothing is sent, so the note would contradict the summary.
    expect(planSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/問卷答案與金額會一併送出/)).toBeNull();
    expect(summary()).toBe("下次提問會送出你的問題和這段對話最近的內容");
  });

  it("shows the stored choice when reopened", async () => {
    saveDraft();
    writePlanOptIn(true);
    await openSheet();
    expect(planSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("lets the person turn an opt-in off even when the draft has become incomplete", async () => {
    writePlanOptIn(true);
    await openSheet();
    // Nothing is sent without a complete draft, so the summary leaves the plan out.
    expect(summary()).toBe("下次提問會送出你的問題和這段對話最近的內容");
    expect(planSwitch().getAttribute("aria-checked")).toBe("true");
    expect((planSwitch() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(planSwitch());
    expect(readPlanOptIn()).toBe(false);
    expect((planSwitch() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("MyDataSheet: summary", () => {
  it("says the question and the recent conversation go out when nothing is saved", async () => {
    await openSheet();
    expect(summary()).toBe("下次提問會送出你的問題和這段對話最近的內容");
  });

  it("says in the privacy list that the recent conversation goes with every question", async () => {
    await openSheet();
    const privacy = screen.getByRole("region", { name: "哪些資料會送出" });
    expect(privacy.textContent).toContain(
      "每次提問會把你的問題（連同這段對話最近的內容）送到伺服器和 AI 模型服務；按「新對話」就會從頭開始。",
    );
  });

  it("lists what would go out and follows edits", async () => {
    saveDraft();
    writeHoldings([{ symbol: "AA" }, { symbol: "BB" }]);
    writeMemory(["x"]);
    await openSheet();
    expect(summary()).toBe("下次提問會送出：2 檔持股、1 則記住的事");
    await userEvent.click(planSwitch());
    expect(summary()).toBe("下次提問會送出：規劃答案、2 檔持股、1 則記住的事");
    await userEvent.click(screen.getByRole("button", { name: "移除 AA" }));
    await userEvent.click(screen.getByRole("button", { name: "刪除：x" }));
    expect(summary()).toBe("下次提問會送出：規劃答案、1 檔持股");
    await userEvent.click(planSwitch());
    await userEvent.click(screen.getByRole("button", { name: "移除 BB" }));
    expect(summary()).toBe("下次提問會送出你的問題和這段對話最近的內容");
  });

  it("matches what buildAskBody puts in the request for the same stored state", async () => {
    saveDraft();
    writePlanOptIn(true);
    writeHoldings([
      { symbol: "0050", amount: 1000 },
      { symbol: "TSM" },
      { symbol: "AAPL", quantity: 3 },
    ]);
    writeMemory(["我是上班族", "不碰槓桿"]);
    await openSheet();

    // Exactly the inputs the chat hook reads when it sends.
    const body = buildAskBody({
      messages: [{ role: "user", content: "hi" }],
      lens: "beginner",
      holdings: readHoldings(),
      memory: readMemory(),
      plan: currentPlanRequest(readPlanOptIn()),
    });
    const counts = {
      plan: body.profile?.plan !== undefined,
      holdings: body.profile?.holdings.length ?? 0,
      memory: body.profile?.memory.length ?? 0,
    };
    expect(counts).toEqual({ plan: true, holdings: 3, memory: 2 });
    expect(
      describeOutgoing({
        holdings: readHoldings(),
        memory: readMemory(),
        plan: currentPlanRequest(readPlanOptIn()),
      }),
    ).toEqual(counts);
    expect(summary()).toBe("下次提問會送出：規劃答案、3 檔持股、2 則記住的事");
  });
});

describe("MyDataSheet: errored rows", () => {
  it("counts a holdings row with an error nowhere: not in the summary, not in the request", async () => {
    writeHoldings([{ symbol: "AA" }, { symbol: "BB", amount: 5 }]);
    await openSheet();
    expect(summary()).toBe("下次提問會送出：2 檔持股");
    const amount = within(screen.getByRole("group", { name: "持股 2" })).getByLabelText(
      "金額（元）",
    );
    await userEvent.clear(amount);
    await userEvent.type(amount, "5.5");
    expect(screen.getByRole("alert").textContent).toContain("請填整數");
    expect(summary()).toBe("下次提問會送出：1 檔持股");
    const body = buildAskBody({
      messages: [{ role: "user", content: "hi" }],
      lens: "beginner",
      holdings: readHoldings(),
      memory: readMemory(),
      plan: currentPlanRequest(readPlanOptIn()),
    });
    expect(body.profile?.holdings).toEqual([{ symbol: "AA" }]);
  });
});

describe("MyDataSheet: content", () => {
  it("explains what is sent, what is not stored, searches and refunds", async () => {
    const dialog = await openSheet();
    const text = dialog.textContent ?? "";
    expect(text).toContain("伺服器和 AI 模型服務");
    // Only the plan answers have a switch; holdings and notes go with every question.
    expect(text).toContain("規劃答案只在你開啟時才送出");
    expect(text).toContain("已存的持股與記住的事，每次提問都會一併送出");
    expect(text).not.toContain("只有在開啟時");
    expect(text).toContain("伺服器不保存對話");
    expect(text).toContain("持股代號可能出現在搜尋內容裡");
    expect(text).toContain("金額和股數我們會盡力擋下");
    expect(text).toContain("不會算次數");
    expect(text).toContain("每天最多退回 5 次");
    expect(within(dialog).getByRole("heading", { name: "帶入規劃答案" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "我的持股" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "記住的事" })).toBeTruthy();
  });

  it("uses a bottom sheet on a phone and a side sheet on a wide screen", async () => {
    const dialog = await openSheet();
    expect(dialog.getAttribute("data-side")).toBe("bottom");
  });

  it("is a side sheet from md up", async () => {
    const restore = matchEveryQuery();
    try {
      const dialog = await openSheet();
      expect(dialog.getAttribute("data-side")).toBe("right");
    } finally {
      restore();
    }
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await openSheet();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "開啟" })),
    );
  });

  it("returns focus to the trigger even when the browser never focused it on click", async () => {
    render(<Host />);
    // Safari: a click does not focus a button, so there is no earlier focus to go back to.
    fireEvent.click(screen.getByRole("button", { name: "開啟" }));
    expect(document.activeElement).not.toBe(screen.getByText("開啟"));
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "開啟" })),
    );
  });

  it("closes with its own close button and returns focus to the trigger", async () => {
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "開啟" })),
    );
  });
});

describe("MyDataSheet: clear all", () => {
  function fillStorage() {
    writeAck();
    writeChat([{ role: "user", content: "q" }]);
    writeHoldings([{ symbol: "AA" }]);
    writeMemory(["m"]);
    writePlanOptIn(true);
    saveDraft();
    writeItem(SETTINGS_KEY, JSON.stringify({ lens: "pro", theme: "dark" }));
    writeItem("muggle.ask.chat.v2", "{}");
  }

  it("asks first, and cancelling changes nothing", async () => {
    fillStorage();
    const onCleared = vi.fn();
    await openSheet(onCleared);
    await userEvent.click(screen.getByRole("button", { name: "清除問問看的所有資料" }));
    expect(screen.getByText(/要清除對話、持股、記住的事/)).toBeTruthy();
    expect(onCleared).not.toHaveBeenCalled();
    expect(keysWithPrefix("muggle.ask.")).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText(/要清除對話、持股、記住的事/)).toBeNull();
    expect(keysWithPrefix("muggle.ask.")).toHaveLength(6);
  });

  it("puts focus back on the clear button after cancel and after clearing", async () => {
    fillStorage();
    await openSheet();
    const clearButton = () => screen.getByRole("button", { name: "清除問問看的所有資料" });
    await userEvent.click(clearButton());
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(document.activeElement).toBe(clearButton());
    await userEvent.click(clearButton());
    await userEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(document.activeElement).toBe(clearButton());
  });

  it("removes every muggle.ask key, leaves the plan draft and settings, and calls onCleared", async () => {
    fillStorage();
    const draftBefore = window.localStorage.getItem(DRAFT_KEY);
    const settingsBefore = window.localStorage.getItem(SETTINGS_KEY);
    const onCleared = vi.fn();
    await openSheet(onCleared);
    await userEvent.click(screen.getByRole("button", { name: "清除問問看的所有資料" }));
    await userEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(onCleared).toHaveBeenCalledOnce();
    expect(keysWithPrefix("muggle.ask.")).toEqual([]);
    for (const key of [CHAT_KEY, HOLDINGS_KEY, MEMORY_KEY, PROFILE_KEY, ACK_KEY]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(draftBefore);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(settingsBefore);

    // The sheet shows the empty state too.
    expect(screen.getByRole("status").textContent).toContain("已清除問問看的所有資料");
    expect(planSwitch().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("還沒有記住的事")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "持股 1" })).toBeNull();
    expect(summary()).toBe("下次提問會送出你的問題和這段對話最近的內容");
  });
});
