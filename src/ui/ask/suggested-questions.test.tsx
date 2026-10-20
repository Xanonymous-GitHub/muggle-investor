import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "./copy";
import { SuggestedQuestions } from "./suggested-questions";

describe("SuggestedQuestions", () => {
  it("shows the intro sentence and the four questions", () => {
    render(<SuggestedQuestions onPick={() => {}} />);
    expect(screen.getByText("AI 會查資料給你它的看法，不是保證，也不構成投資建議。")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("sends the exact text of the tapped question", async () => {
    const onPick = vi.fn();
    render(<SuggestedQuestions onPick={onPick} />);
    for (const question of ASK_COPY.chat.suggestions) {
      await userEvent.click(screen.getByRole("button", { name: question }));
      expect(onPick).toHaveBeenLastCalledWith(question);
    }
    expect(onPick).toHaveBeenCalledTimes(4);
  });

  it("makes every question a target of at least 44 px", () => {
    render(<SuggestedQuestions onPick={() => {}} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-11");
    }
  });
});
