import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import {
  AMOUNT_COPY,
  AMOUNT_ERROR_COPY,
  FORM_COPY,
  PRIVACY_LINE,
  QUESTION_COPY,
} from "@/ui/plan/copy";
import { emptyDraft, type PlanDraft } from "@/ui/plan/draft";
import { QuestionnaireWizard } from "@/ui/plan/questionnaire-wizard";

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

function Harness({
  initial = emptyDraft(),
  onChange = () => {},
  onDone = () => {},
  startAt = "first-open",
}: {
  initial?: PlanDraft;
  onChange?: (draft: PlanDraft) => void;
  onDone?: () => void;
  startAt?: "first-open" | "first";
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <QuestionnaireWizard
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        onChange(next);
      }}
      onDone={onDone}
      startAt={startAt}
    />
  );
}

const label = (id: (typeof QUESTIONS)[number]["id"], index: number) =>
  QUESTIONS.find((q) => q.id === id)?.options[index]?.label ?? "";
const amountInput = (field: keyof typeof AMOUNT_COPY) =>
  screen.getByLabelText(AMOUNT_COPY[field].label) as HTMLInputElement;

// Only Date is faked: the wizard ignores a tap that lands right after a step change, and a test
// that walks the steps must let that window pass.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});
// Radix moves focus (and so selects) a tick after the key goes down, and only while the key is
// still held; userEvent's plain `{ArrowDown}` releases it too early, so hold it for a tick.
async function arrowDown(times = 1) {
  for (let i = 0; i < times; i++) {
    await userEvent.keyboard("{ArrowDown>}");
    await userEvent.keyboard("{/ArrowDown}");
  }
}
const later = (ms = 400) => vi.advanceTimersByTime(ms);

describe("QuestionnaireWizard", () => {
  it("shows question 1 only, with the first progress step", () => {
    render(<Harness />);
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.queryByText(QUESTION_COPY.horizon.prompt)).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getByLabelText("第 1 步，共 6 步")).toBeTruthy();
    expect(screen.queryByRole("button", { name: FORM_COPY.back })).toBeNull();
  });

  it("stores the choice, advances to question 2, and Back keeps the earlier answer", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: label("age", 2) }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ answers: { age: "age-40-49" } }),
    );
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
    expect(screen.queryByText(QUESTION_COPY.age.prompt)).toBeNull();
    expect(screen.getByLabelText("第 2 步，共 6 步")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.back }));
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("age", 2) }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("advances again when the already chosen option is tapped after Back", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: label("age", 2) }));
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.back }));
    later();
    await userEvent.click(screen.getByRole("radio", { name: label("age", 2) }));
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
  });

  it("reaches and selects the fourth option by keyboard without leaving the question", async () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    const next = screen.getByRole("button", { name: FORM_COPY.next }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    await userEvent.tab();
    await arrowDown(3);
    expect(screen.getByRole("radio", { name: label("age", 3) }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.queryByText(QUESTION_COPY.horizon.prompt)).toBeNull();
    expect(next.disabled).toBe(false);

    await userEvent.click(next);
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
  });

  it("selects with Space and still waits for 下一步", async () => {
    render(<Harness />);
    await userEvent.tab();
    await userEvent.keyboard(" ");
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
  });

  it("walks every question with the keyboard alone", async () => {
    render(<Harness />);
    for (const q of QUESTIONS) {
      expect(screen.getByText(QUESTION_COPY[q.id].prompt)).toBeTruthy();
      await userEvent.tab();
      await arrowDown();
      await userEvent.click(screen.getByRole("button", { name: FORM_COPY.next }));
    }
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
  });

  it("ignores a second tap right after a step change and accepts one after 300 ms", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("radio", { name: label("age", 0) }));
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();

    // The tail of a double tap lands on question 2: it must not skip it.
    later(100);
    await userEvent.click(screen.getByRole("radio", { name: label("horizon", 0) }));
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
    expect(screen.queryByText(QUESTION_COPY.income.prompt)).toBeNull();

    later(300);
    await userEvent.click(screen.getByRole("radio", { name: label("horizon", 1) }));
    expect(screen.getByText(QUESTION_COPY.income.prompt)).toBeTruthy();
  });

  it("opens on question 1 with startAt first, even for a complete draft", () => {
    render(<Harness initial={FULL} startAt="first" />);
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.getByRole("radio", { name: label("age", 2) }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("opens on the first unanswered question of a stored draft", () => {
    render(<Harness initial={{ ...emptyDraft(), answers: { age: "age-40-49" } }} />);
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
    expect(screen.getByLabelText("第 2 步，共 6 步")).toBeTruthy();
  });

  it("walks the five questions to the amounts page", async () => {
    render(<Harness />);
    for (const q of QUESTIONS) {
      expect(screen.getByText(QUESTION_COPY[q.id].prompt)).toBeTruthy();
      later();
      await userEvent.click(screen.getByRole("radio", { name: q.options[0].label }));
    }
    expect(screen.getByLabelText("第 6 步，共 6 步")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(screen.getByText(PRIVACY_LINE)).toBeTruthy();
    expect(screen.getByRole("button", { name: FORM_COPY.submit })).toBeTruthy();
  });

  it("opens on the amounts page when every question is already answered", () => {
    render(<Harness initial={FULL} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("shows an amount error only after the field is blurred", async () => {
    render(<Harness initial={FULL} />);
    const lump = amountInput("lump");
    await userEvent.clear(lump);
    await userEvent.type(lump, "12.5");
    expect(screen.queryByText(AMOUNT_ERROR_COPY.not_integer)).toBeNull();
    await userEvent.tab();
    expect(screen.getByText(AMOUNT_ERROR_COPY.not_integer)).toBeTruthy();
    expect(lump.getAttribute("aria-invalid")).toBe("true");
    expect(amountInput("monthly").getAttribute("aria-invalid")).not.toBe("true");
  });

  it("calls onDone once when everything is valid", async () => {
    const onDone = vi.fn();
    render(<Harness initial={FULL} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not call onDone for lump 0 and monthly 0, and says why", async () => {
    const onDone = vi.fn();
    const draft = { ...FULL, amounts: { ...FULL.amounts, lump: "0", monthly: "0" } };
    render(<Harness initial={draft} onDone={onDone} />);
    expect(screen.queryByText(AMOUNT_ERROR_COPY.zero)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(AMOUNT_ERROR_COPY.zero)).toBeTruthy();
  });

  it("shows every empty field's error after a submit attempt", async () => {
    const onDone = vi.fn();
    render(<Harness initial={{ ...FULL, amounts: emptyDraft().amounts }} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getAllByText(AMOUNT_ERROR_COPY.empty)).toHaveLength(4);
  });
});
