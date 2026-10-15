// Testing Library collapses whitespace (the full-width space too) before matching text.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReserveCard } from "@/ui/plan/reserve-card";
import { reserveView } from "@/ui/plan/view-model";
import { LEVEL3_PLAN, RESERVE_ONLY_PLAN } from "@/ui/test/plan-fixture";

describe("ReserveCard", () => {
  it("says the reserve is complete when there is no gap", () => {
    render(<ReserveCard view={reserveView(LEVEL3_PLAN, 600000)} />);
    expect(screen.getByText("緊急預備金 90,000 元 已備齊")).toBeTruthy();
  });

  it("shows what is still missing", () => {
    render(<ReserveCard view={reserveView(RESERVE_ONLY_PLAN, 20000)} />);
    expect(screen.getByText("緊急預備金 90,000 元 還差 50,000 元")).toBeTruthy();
  });

  it("says this time fills the gap, and where the rest goes", () => {
    render(<ReserveCard view={reserveView(RESERVE_ONLY_PLAN, 100000)} />);
    expect(screen.getByText("緊急預備金 90,000 元 這次就能補滿")).toBeTruthy();
    expect(
      screen.getByText("目前有 20,000 元，這次先放進 70,000 元補滿，剩下的錢才拿去投資。"),
    ).toBeTruthy();
  });

  it("leaves out the detail line when asked to", () => {
    render(<ReserveCard view={reserveView(RESERVE_ONLY_PLAN, 100000)} detail={false} />);
    expect(screen.queryByText(/剩下的錢才拿去投資/)).toBeNull();
  });
});
