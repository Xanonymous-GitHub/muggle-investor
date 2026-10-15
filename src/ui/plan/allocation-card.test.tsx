// Testing Library collapses whitespace (the full-width space too) before matching text.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AllocationCard } from "@/ui/plan/allocation-card";
import {
  BOND_AS_CASH_PLAN,
  INSUFFICIENT_HISTORY_PLAN,
  LEVEL1_PLAN,
  LEVEL3_PLAN,
} from "@/ui/test/plan-fixture";

describe("AllocationCard", () => {
  it("titles the card with the investable amount", () => {
    render(<AllocationCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
  });

  it("lists the five slices with amount, percent and instrument", () => {
    render(<AllocationCard plan={LEVEL3_PLAN} lens="beginner" />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    const core = rows[0] as HTMLElement;
    expect(within(core).getByText("核心：市值型 ETF")).toBeTruthy();
    expect(within(core).getByText("45%")).toBeTruthy();
    expect(within(core).getByText("270,000 元")).toBeTruthy();
    expect(within(core).getByText("元大台灣50（0050） 備選 006208")).toBeTruthy();
    expect(screen.getByText("元大美債20年（00679B） 備選 00687B")).toBeTruthy();
    expect(screen.getByText("元大高股息（0056） 備選 00713")).toBeTruthy();
    expect(screen.getByText("沒有指定單一標的，試算時以核心標的的含息報酬代替")).toBeTruthy();
    expect(screen.getByText("試算時不計報酬")).toBeTruthy();
  });

  it("has no satellite row for level 1", () => {
    render(<AllocationCard plan={LEVEL1_PLAN} lens="beginner" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.queryByText("衛星")).toBeNull();
  });

  it("labels the stacked bar with every percent and sizes segments by amount", () => {
    render(<AllocationCard plan={LEVEL3_PLAN} lens="beginner" />);
    const bar = screen.getByRole("img", {
      name: "配置比例：核心：市值型 ETF 45%、債券 ETF 25%、高股息 ETF 20%、衛星 5%、現金 5%",
    });
    const segments = [...bar.children] as HTMLElement[];
    expect(segments.map((s) => s.style.flexGrow)).toEqual([
      "270000",
      "150000",
      "120000",
      "30000",
      "30000",
    ]);
    expect(segments[0]?.className).toContain("bg-slice-core");
    expect(segments[4]?.className).toContain("bg-slice-cash");
  });

  it("words the yearly rebalancing note per lens", () => {
    const { rerender } = render(<AllocationCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByText("試算時每年一次，把各份調回上面的比例。")).toBeTruthy();
    rerender(<AllocationCard plan={LEVEL3_PLAN} lens="pro" />);
    expect(screen.getByText("試算含每年一次再平衡，回到目標權重。")).toBeTruthy();
    expect(screen.queryByText(/把各份調回/)).toBeNull();
  });

  it("holds the bond slice as cash when the bond ETF is not eligible", () => {
    render(<AllocationCard plan={BOND_AS_CASH_PLAN} lens="beginner" />);
    expect(screen.queryByText("債券 ETF")).toBeNull();
    expect(screen.getByText("180,000 元")).toBeTruthy();
  });

  it("shows slices without instruments when the history was too short", () => {
    render(<AllocationCard plan={INSUFFICIENT_HISTORY_PLAN} lens="beginner" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("核心：市值型 ETF")).toBeTruthy();
  });
});
