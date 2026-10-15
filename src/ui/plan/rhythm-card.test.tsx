import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RhythmCard } from "@/ui/plan/rhythm-card";
import { LEVEL3_PLAN, RESERVE_ONLY_PLAN } from "@/ui/test/plan-fixture";

describe("RhythmCard", () => {
  it("shows the tranche months and the monthly top-up for level 3", () => {
    render(<RhythmCard plan={LEVEL3_PLAN} monthly={15000} lens="beginner" />);
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
    expect(screen.getByText("第 1–6 個月")).toBeTruthy();
    expect(
      screen.getByText(
        "每個月投入 115,000 元（現有的錢分成 6 份，每月放 100,000 元，再加上每月固定的 15,000 元）",
      ),
    ).toBeTruthy();
    expect(screen.getByText("第 7 個月起")).toBeTruthy();
    expect(screen.getByText("每個月 15,000 元")).toBeTruthy();
  });

  it("uses the pro wording in the pro lens", () => {
    render(<RhythmCard plan={LEVEL3_PLAN} monthly={15000} lens="pro" />);
    expect(screen.getByText("每月 115,000 元（分批 100,000 + 定期 15,000，分 6 期）")).toBeTruthy();
  });

  it("renders nothing for a reserve-only plan", () => {
    const { container } = render(
      <RhythmCard plan={RESERVE_ONLY_PLAN} monthly={10000} lens="beginner" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
