// Accessibility checks for the planner screen that need no layout: names, keyboard operation,
// error wiring, focus order, ids. What only a browser can show (focus ring look, wrapping) is
// verified by hand and recorded in the task report.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import type { PlanRequest } from "@/planner/schema";
import type { PlanExplanationJson } from "@/ui/data/api";
import { SettingsProvider } from "@/ui/device/settings-provider";
import {
  AMOUNT_COPY,
  AMOUNT_ERROR_COPY,
  ANSWER_MISSING,
  FORM_COPY,
  QUESTION_COPY,
} from "@/ui/plan/copy";
import { DRAFT_KEY, emptyDraft, type PlanDraft, serializeDraft } from "@/ui/plan/draft";
import { ExplanationCard } from "@/ui/plan/explanation-card";
import { HistoryCard } from "@/ui/plan/history-card";
import { PlannerScreen } from "@/ui/plan/planner-screen";
import { QuestionnaireForm } from "@/ui/plan/questionnaire-form";
import { QuestionnaireWizard } from "@/ui/plan/questionnaire-wizard";
import { ResultView } from "@/ui/plan/result-view";
import { giveChartsASize } from "@/ui/test/chart-size";
import { matchEveryQuery } from "@/ui/test/match-media";
import {
  BOND_AS_CASH_PLAN,
  EXPLANATION_FIXTURE,
  INSUFFICIENT_HISTORY_PLAN,
  LEVEL1_PLAN,
  LEVEL3_PLAN,
  RESERVE_ONLY_PLAN,
} from "@/ui/test/plan-fixture";

// The live result has its own tests; here it only has to appear and offer 修改答案.
vi.mock("@/ui/plan/result-container", () => ({
  ResultContainer: ({ onEdit }: { onEdit(): void }) => (
    <div>
      <p>結果</p>
      <button type="button" onClick={onEdit}>
        修改答案
      </button>
    </div>
  ),
}));

const FULL: PlanDraft = {
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

const REQUEST: PlanRequest = {
  answers: FULL.answers as PlanRequest["answers"],
  lump: 600000,
  monthly: 15000,
  monthlyExpenses: 30000,
  existingReserve: 90000,
};

function Harness({
  layout,
  initial = emptyDraft(),
  onDone = () => {},
}: {
  layout: "wizard" | "form";
  initial?: PlanDraft;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return layout === "wizard" ? (
    <QuestionnaireWizard draft={draft} onChange={setDraft} onDone={onDone} startAt="first-open" />
  ) : (
    <QuestionnaireForm draft={draft} onChange={setDraft} onDone={onDone} />
  );
}

// Radix selects an option when it receives focus from an arrow key, and only while the key is
// held, so the key is held for a tick (same as the wizard's own tests).
async function arrowDown(times = 1) {
  for (let i = 0; i < times; i++) {
    await userEvent.keyboard("{ArrowDown>}");
    await userEvent.keyboard("{/ArrowDown}");
  }
}

// The wizard ignores a tap right after a step change; only Date is faked so tests can wait it out.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const idsOf = (root: ParentNode): string[] =>
  [...root.querySelectorAll("[id]")].map((element) => element.id);
const duplicates = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);

const describedText = (element: HTMLElement): string =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

describe("accessible names", () => {
  it("names every amount input and every radio, and every radiogroup by its question", () => {
    render(<Harness layout="form" initial={FULL} />);
    for (const { label } of Object.values(AMOUNT_COPY)) {
      expect(screen.getByRole("textbox", { name: label })).toBeTruthy();
    }
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    for (const question of QUESTIONS) {
      const group = screen.getByRole("radiogroup", { name: QUESTION_COPY[question.id].prompt });
      for (const option of question.options) {
        expect(within(group).getByRole("radio", { name: option.label })).toBeTruthy();
      }
    }
    expect(screen.getAllByRole("radio")).toHaveLength(
      QUESTIONS.reduce((sum, q) => sum + q.options.length, 0),
    );
  });

  it("names the wizard's radios, group and amount inputs too", () => {
    const { unmount } = render(<Harness layout="wizard" />);
    const group = screen.getByRole("radiogroup", { name: QUESTION_COPY.age.prompt });
    for (const option of QUESTIONS[0].options) {
      expect(within(group).getByRole("radio", { name: option.label })).toBeTruthy();
    }
    unmount();
    render(<Harness layout="wizard" initial={FULL} />);
    for (const { label } of Object.values(AMOUNT_COPY)) {
      expect(screen.getByRole("textbox", { name: label })).toBeTruthy();
    }
  });
});

describe("wizard keyboard (R-U1)", () => {
  it("chooses with arrow keys, then moves on with 下一步 and Enter", async () => {
    render(<Harness layout="wizard" />);
    const next = screen.getByRole("button", { name: FORM_COPY.next }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    await userEvent.tab();
    await arrowDown(2);
    expect(
      screen
        .getByRole("radio", { name: QUESTIONS[0].options[2].label })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // Choosing alone never advances.
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(next.disabled).toBe(false);

    await userEvent.tab();
    expect(document.activeElement).toBe(next);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
  });

  it("moves focus to the new step's heading after advancing, and after going back", async () => {
    render(<Harness layout="wizard" />);
    await userEvent.tab();
    await arrowDown();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const heading = screen.getByRole("heading", { name: QUESTION_COPY.horizon.prompt });
    expect(document.activeElement).toBe(heading);

    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.back }));
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: QUESTION_COPY.age.prompt }),
    );
  });

  it("moves focus to the amounts heading after the last question", async () => {
    render(
      <Harness layout="wizard" initial={{ ...FULL, answers: { ...FULL.answers, loss: "" } }} />,
    );
    // loss is the one open question (the Back button comes first in tab order); pick it, advance.
    screen.getAllByRole("radio")[0]?.focus();
    await arrowDown();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: FORM_COPY.amountsTitle }),
    );
  });
});

describe("error text is tied to its field", () => {
  it("describes an invalid amount input by its own error and marks it invalid", async () => {
    render(<Harness layout="wizard" initial={FULL} />);
    const lump = screen.getByRole("textbox", { name: AMOUNT_COPY.lump.label });
    await userEvent.clear(lump);
    await userEvent.type(lump, "12.5");
    await userEvent.tab();
    expect(lump.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(lump)).toContain(AMOUNT_ERROR_COPY.not_integer);
    // The hint stays part of the description.
    expect(describedText(lump)).toContain(AMOUNT_COPY.lump.hint);
    const other = screen.getByRole("textbox", { name: AMOUNT_COPY.monthly.label });
    expect(describedText(other)).not.toContain(AMOUNT_ERROR_COPY.not_integer);
  });

  it("describes both lump and monthly by the 'not both zero' error", async () => {
    render(
      <Harness
        layout="wizard"
        initial={{ ...FULL, amounts: { ...FULL.amounts, lump: "0", monthly: "0" } }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(screen.getByRole("alert").textContent).toBe(AMOUNT_ERROR_COPY.zero);
    for (const field of ["lump", "monthly"] as const) {
      const input = screen.getByRole("textbox", { name: AMOUNT_COPY[field].label });
      expect(describedText(input)).toContain(AMOUNT_ERROR_COPY.zero);
      expect(input.getAttribute("aria-invalid")).toBe("true");
    }
    const expenses = screen.getByRole("textbox", { name: AMOUNT_COPY.monthlyExpenses.label });
    expect(describedText(expenses)).not.toContain(AMOUNT_ERROR_COPY.zero);
  });

  it("describes an unanswered question's group by its error after a submit attempt", async () => {
    render(<Harness layout="form" initial={{ ...FULL, answers: { ...FULL.answers, loss: "" } }} />);
    const group = screen.getByRole("radiogroup", { name: QUESTION_COPY.loss.prompt });
    expect(describedText(group)).not.toContain(ANSWER_MISSING);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(describedText(group)).toContain(ANSWER_MISSING);
    const answered = screen.getByRole("radiogroup", { name: QUESTION_COPY.age.prompt });
    expect(describedText(answered)).not.toContain(ANSWER_MISSING);
  });
});

describe("focus after a failed submit", () => {
  const withAmounts = (amounts: Partial<PlanDraft["amounts"]>): PlanDraft => ({
    ...FULL,
    amounts: { ...FULL.amounts, ...amounts },
  });

  it("moves to the first unanswered question's first radio on the single-page form", async () => {
    const draft = { ...FULL, answers: { ...FULL.answers, horizon: "", loss: "" } };
    render(<Harness layout="form" initial={draft} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    const group = screen.getByRole("radiogroup", { name: QUESTION_COPY.horizon.prompt });
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(within(group).getAllByRole("radio")[0]);
    // Moving focus does not choose anything.
    expect(within(group).queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("moves to the first invalid amount in DOM order when every question is answered", async () => {
    render(
      <Harness
        layout="form"
        initial={withAmounts({ monthlyExpenses: "", existingReserve: "x" })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: AMOUNT_COPY.monthlyExpenses.label }),
    );
  });

  it("prefers a missing answer to an invalid amount, as the questions come first", async () => {
    const draft = { ...withAmounts({ lump: "" }), answers: { ...FULL.answers, loss: "" } };
    render(<Harness layout="form" initial={draft} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    const group = screen.getByRole("radiogroup", { name: QUESTION_COPY.loss.prompt });
    expect(document.activeElement).toBe(within(group).getAllByRole("radio")[0]);
  });

  it("moves to the lump field when lump and monthly are both zero", async () => {
    render(<Harness layout="form" initial={withAmounts({ lump: "0", monthly: "0" })} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: AMOUNT_COPY.lump.label }),
    );
  });

  it("moves to the first invalid amount on the wizard's amounts step", async () => {
    render(<Harness layout="wizard" initial={withAmounts({ monthly: "1.5" })} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: AMOUNT_COPY.monthly.label }),
    );
  });

  it("moves focus nowhere when the submit succeeds", async () => {
    const onDone = vi.fn();
    render(<Harness layout="form" initial={FULL} onDone={onDone} />);
    const submit = screen.getByRole("button", { name: FORM_COPY.submit });
    await userEvent.click(submit);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(submit);
  });

  it("moves focus back to the invalid field on each further failed submit", async () => {
    render(<Harness layout="form" initial={withAmounts({ lump: "" })} />);
    const lump = screen.getByRole("textbox", { name: AMOUNT_COPY.lump.label });
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(document.activeElement).toBe(lump);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(document.activeElement).toBe(lump);
  });
});

describe("focus when the screen changes mode (WCAG 2.4.3)", () => {
  let restoreQueries: (() => void) | null = null;
  afterEach(() => {
    restoreQueries?.();
    restoreQueries = null;
    window.localStorage.clear();
  });

  const renderScreen = () =>
    render(
      <SettingsProvider>
        <PlannerScreen />
      </SettingsProvider>,
    );
  const heading = () => screen.getByRole("heading", { level: 1, name: FORM_COPY.title });

  it("does not take focus on the initial load, with a stored draft or without", () => {
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    const stored = renderScreen();
    expect(screen.getByText("結果")).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
    stored.unmount();
    window.localStorage.clear();
    renderScreen();
    expect(document.activeElement).toBe(document.body);
  });

  it("makes the h1 programmatically focusable but not a tab stop", () => {
    renderScreen();
    expect(heading().getAttribute("tabindex")).toBe("-1");
  });

  it("focuses the h1 after 看我的規劃 and after 修改答案, wide layout", async () => {
    restoreQueries = matchEveryQuery();
    window.localStorage.setItem(
      DRAFT_KEY,
      serializeDraft({ ...FULL, amounts: { ...FULL.amounts, lump: "" } }),
    );
    renderScreen();
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.lump.label), "600000");
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(screen.getByText("結果")).toBeTruthy();
    expect(document.activeElement).toBe(heading());

    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(document.activeElement).toBe(heading());
  });

  it("focuses the h1 after 修改答案 in the wizard layout, and not on opening", async () => {
    window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
    renderScreen();
    expect(document.activeElement).toBe(document.body);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(document.activeElement).toBe(heading());
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
  });

  it("focuses the h1 after 看我的規劃 in the wizard layout", async () => {
    window.localStorage.setItem(
      DRAFT_KEY,
      serializeDraft({ ...FULL, amounts: { ...FULL.amounts, lump: "" } }),
    );
    renderScreen();
    // Every question is answered, so the wizard opens on the amounts.
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.lump.label), "600000");
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(screen.getByText("結果")).toBeTruthy();
    expect(document.activeElement).toBe(heading());
  });
});

describe("the history card", () => {
  let restoreSize: () => void;
  beforeEach(() => {
    restoreSize = giveChartsASize();
  });
  afterEach(() => restoreSize());

  it("hides the chart and keeps nothing focusable inside it, on both tabs", async () => {
    const { container } = render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    const check = () => {
      const chart = container.querySelector("[data-slot=history-chart]");
      expect(chart?.getAttribute("aria-hidden")).toBe("true");
      expect(chart?.querySelector("svg")).not.toBeNull();
      expect(
        chart?.querySelectorAll(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role=application]',
        ),
      ).toHaveLength(0);
    };
    check();
    await userEvent.click(screen.getByRole("tab", { name: "只有股票" }));
    check();
  });

  it("gives the table a caption that carries its window", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    const table = screen.getByRole("table", { name: /2017-01-17 至 2026-10-14，共 9.7 年/ });
    expect(table.querySelector("caption")?.textContent).toMatch(/^三種投入方式比較，2017-01-17/);
  });

  it("keeps words together in the table so a narrow screen breaks at spaces and brackets", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByRole("table").className).toContain("[word-break:keep-all]");
  });

  it("makes the tab triggers at least 44px tall", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("h-11");
    }
  });
});

describe("ids", () => {
  const EXPLANATION = {
    status: "ready",
    data: EXPLANATION_FIXTURE as PlanExplanationJson,
    dataDate: null,
    fromCache: false,
    savedAt: null,
    refreshFailed: false,
    reload() {},
  } as const;

  let restoreSize: () => void;
  beforeEach(() => {
    restoreSize = giveChartsASize();
  });
  afterEach(() => restoreSize());

  const fixtures = {
    "level 3": LEVEL3_PLAN,
    "level 1": LEVEL1_PLAN,
    "reserve only": RESERVE_ONLY_PLAN,
    "insufficient history": INSUFFICIENT_HISTORY_PLAN,
    "bond as cash": BOND_AS_CASH_PLAN,
  } as const;

  it.each(Object.entries(fixtures))(
    "has no duplicate ids in a full %s result",
    async (_name, plan) => {
      const view = (lens: "beginner" | "pro"): ReactElement => (
        <ResultView
          plan={plan}
          request={REQUEST}
          lens={lens}
          explanation={<ExplanationCard resource={EXPLANATION} onOpenTerm={() => {}} />}
          history={plan.kind === "plan" ? <HistoryCard plan={plan} lens={lens} /> : null}
        />
      );
      const { container, unmount } = render(view("beginner"));
      expect(duplicates(idsOf(container))).toEqual([]);
      if (plan.kind === "plan") {
        await userEvent.click(screen.getByRole("tab", { name: "只有股票" }));
        expect(duplicates(idsOf(container))).toEqual([]);
      }
      unmount();
      const pro = render(view("pro"));
      expect(duplicates(idsOf(pro.container))).toEqual([]);
    },
  );

  it("has no duplicate ids in either questionnaire layout", () => {
    const form = render(<Harness layout="form" initial={FULL} />);
    const formIds = idsOf(form.container);
    expect(duplicates(formIds)).toEqual([]);
    form.unmount();
    const wizard = render(<Harness layout="wizard" initial={FULL} />);
    expect(duplicates(idsOf(wizard.container))).toEqual([]);
  });
});
