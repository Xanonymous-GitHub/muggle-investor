import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import {
  AMOUNT_COPY,
  AMOUNT_ERROR_COPY,
  ANSWER_MISSING,
  FORM_COPY,
  PRIVACY_LINE,
  QUESTION_COPY,
} from "@/ui/plan/copy";
import { emptyDraft, type PlanDraft } from "@/ui/plan/draft";
import { QuestionnaireForm } from "@/ui/plan/questionnaire-form";

function Harness({ onDone = () => {} }: { onDone?: () => void }) {
  const [draft, setDraft] = useState<PlanDraft>(emptyDraft());
  return <QuestionnaireForm draft={draft} onChange={setDraft} onDone={onDone} />;
}

describe("QuestionnaireForm", () => {
  it("shows all nine inputs on one page with every prompt", () => {
    render(<Harness />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(5);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    for (const q of QUESTIONS) {
      expect(screen.getByText(QUESTION_COPY[q.id].prompt)).toBeTruthy();
      expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole("radio")).toHaveLength(
      QUESTIONS.reduce((n, q) => n + q.options.length, 0),
    );
    expect(screen.getByText(PRIVACY_LINE)).toBeTruthy();
  });

  it("names each radio group by its question", () => {
    render(<Harness />);
    for (const q of QUESTIONS) {
      expect(screen.getByRole("radiogroup", { name: QUESTION_COPY[q.id].prompt })).toBeTruthy();
    }
  });

  it("does not submit while incomplete, then submits once everything is filled", async () => {
    const onDone = vi.fn();
    render(<Harness onDone={onDone} />);
    const submit = screen.getByRole("button", { name: FORM_COPY.submit });

    await userEvent.click(submit);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getAllByText(AMOUNT_ERROR_COPY.empty)).toHaveLength(4);

    for (const q of QUESTIONS) {
      await userEvent.click(screen.getByRole("radio", { name: q.options[0].label }));
    }
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.lump.label), "600000");
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.monthly.label), "0");
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.monthlyExpenses.label), "30000");
    await userEvent.type(screen.getByLabelText(AMOUNT_COPY.existingReserve.label), "0");
    await userEvent.click(submit);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(AMOUNT_COPY.lump.label) as HTMLInputElement).value).toBe(
      "600,000",
    );
  });

  it("flags a question left unanswered after a submit attempt", async () => {
    render(<Harness />);
    expect(screen.queryByText(ANSWER_MISSING)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.submit }));
    expect(screen.getAllByText(ANSWER_MISSING)).toHaveLength(5);
  });
});
