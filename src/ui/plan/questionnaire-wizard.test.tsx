import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
}: {
  initial?: PlanDraft;
  onChange?: (draft: PlanDraft) => void;
  onDone?: () => void;
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
    />
  );
}

const label = (id: (typeof QUESTIONS)[number]["id"], index: number) =>
  QUESTIONS.find((q) => q.id === id)?.options[index]?.label ?? "";
const amountInput = (field: keyof typeof AMOUNT_COPY) =>
  screen.getByLabelText(AMOUNT_COPY[field].label) as HTMLInputElement;

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
    await userEvent.click(screen.getByRole("radio", { name: label("age", 2) }));
    expect(screen.getByText(QUESTION_COPY.horizon.prompt)).toBeTruthy();
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
