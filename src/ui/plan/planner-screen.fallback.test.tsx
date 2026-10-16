// A draft that cannot become a request never reaches the result.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { PlannerScreen } from "@/ui/plan/planner-screen";

vi.mock("@/ui/plan/result-container", () => ({
  ResultContainer: () => <p>結果</p>,
}));
// Reports done although nothing was answered.
vi.mock("@/ui/plan/questionnaire-wizard", () => ({
  QuestionnaireWizard: ({ onDone }: { onDone(): void }) => (
    <button type="button" onClick={onDone}>
      完成
    </button>
  ),
}));

afterEach(() => window.localStorage.clear());

describe("PlannerScreen", () => {
  it("stays in the questionnaire when done is reported for an incomplete draft", async () => {
    render(
      <SettingsProvider>
        <PlannerScreen />
      </SettingsProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByText("結果")).toBeNull();
    expect(screen.getByRole("button", { name: "完成" })).toBeTruthy();
  });
});
