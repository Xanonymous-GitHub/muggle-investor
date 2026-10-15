import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEVEL_NAMES } from "@/planner/rules/levels";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { FORM_COPY, QUESTION_COPY } from "@/ui/plan/copy";
import { DRAFT_KEY, EMPTY_DRAFT, parseDraft, serializeDraft } from "@/ui/plan/draft";
import { PlannerScreen } from "@/ui/plan/planner-screen";
import { matchEveryQuery } from "@/ui/test/match-media";

const FULL = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  amounts: {
    lump: "600,000",
    monthly: "15,000",
    monthlyExpenses: "30,000",
    existingReserve: "90,000",
  },
};

function renderScreen() {
  return render(
    <SettingsProvider>
      <PlannerScreen />
    </SettingsProvider>,
  );
}

let restore: (() => void) | null = null;
// Only Date is faked: the wizard ignores a tap right after a step change (a double-tap guard).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  restore?.();
  restore = null;
  window.localStorage.clear();
});

const storedDraft = () => parseDraft(window.localStorage.getItem(DRAFT_KEY));

describe("PlannerScreen", () => {
  it("starts in the form with the 規劃 heading when nothing is stored", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "規劃" })).toBeTruthy();
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.queryByText("結果")).toBeNull();
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("starts in the result when the stored draft is complete", () => {
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    renderScreen();
    expect(screen.getByText("結果")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("reopens a partly answered stored draft at the first unanswered question", () => {
    const { reserve, loss, ...three } = FULL.answers;
    expect([reserve, loss]).toEqual(["reserve-3-6m", "loss-hold"]);
    window.localStorage.setItem(DRAFT_KEY, serializeDraft({ ...FULL, answers: three }));
    renderScreen();
    expect(screen.getByText(QUESTION_COPY.reserve.prompt)).toBeTruthy();
    expect(screen.queryByText("結果")).toBeNull();
    expect(screen.getByLabelText("第 4 步，共 6 步")).toBeTruthy();
  });

  it("opens at question 1 with its answer selected when going back from the result", async () => {
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(screen.queryByText("結果")).toBeNull();
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "40–49" }).getAttribute("aria-checked")).toBe("true");
  });

  it("shows the amounts again after 修改答案 on a wide screen", async () => {
    restore = matchEveryQuery();
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect((screen.getByLabelText("現在可以投入的錢") as HTMLInputElement).value).toBe("600,000");
  });

  it("reads storage only after mount: the server render is the empty form", () => {
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    const html = renderToString(
      <SettingsProvider>
        <PlannerScreen />
      </SettingsProvider>,
    );
    expect(html).toContain(QUESTION_COPY.age.prompt);
    expect(html).not.toContain("結果");
    expect(html).not.toContain('aria-checked="true"');
  });

  it("shows the form with nothing selected for a corrupt stored draft", () => {
    window.localStorage.setItem(DRAFT_KEY, "}{ not json");
    renderScreen();
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.queryByText("結果")).toBeNull();
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("keeps the valid fields of a partly corrupt draft", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        answers: { age: "age-99", horizon: "horizon-5-10y" },
        amounts: { lump: 5 },
      }),
    );
    renderScreen();
    // The bad age id is dropped, so the wizard opens on question 1 with nothing selected.
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    await userEvent.click(screen.getByRole("radio", { name: "60 歲以上" }));
    expect(storedDraft().answers).toEqual({ age: "age-60-plus", horizon: "horizon-5-10y" });
  });

  it("writes every edit to localStorage under DRAFT_KEY", async () => {
    renderScreen();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "60 歲以上" }));
    expect(storedDraft().answers).toEqual({ age: "age-60-plus" });
    expect(storedDraft().amounts).toEqual(EMPTY_DRAFT.amounts);
  });

  it("shows the single-page form on a wide screen and the wizard otherwise", () => {
    const narrow = renderScreen();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    narrow.unmount();

    restore = matchEveryQuery();
    renderScreen();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
  });

  it("moves from the form to the result when the plan is requested, and saves the reformatted amounts", async () => {
    restore = matchEveryQuery();
    window.localStorage.setItem(
      DRAFT_KEY,
      serializeDraft({ ...FULL, amounts: { ...FULL.amounts, lump: "" } }),
    );
    renderScreen();
    expect(screen.queryByText("結果")).toBeNull();
    await userEvent.type(screen.getByLabelText("現在可以投入的錢"), "600000");
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(screen.getByText("結果")).toBeTruthy();
    expect(storedDraft().amounts.lump).toBe("600,000");
  });

  it("never shows a level name while answering, on any step or layout", async () => {
    const expectNoLevel = (container: HTMLElement) => {
      for (const name of Object.values(LEVEL_NAMES))
        expect(container.textContent).not.toContain(name);
    };

    const narrow = renderScreen();
    expectNoLevel(narrow.container);
    for (const q of QUESTIONS) {
      vi.advanceTimersByTime(400);
      await userEvent.click(screen.getByRole("radio", { name: q.options[2]?.label ?? "" }));
      expectNoLevel(narrow.container);
    }
    // Now on the amounts step.
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expectNoLevel(narrow.container);
    narrow.unmount();

    restore = matchEveryQuery();
    window.localStorage.setItem(DRAFT_KEY, serializeDraft({ ...FULL, answers: {} }));
    const wide = renderScreen();
    expectNoLevel(wide.container);
    for (const q of QUESTIONS) {
      await userEvent.click(screen.getByRole("radio", { name: q.options[0].label }));
    }
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expectNoLevel(wide.container);
  });
});
