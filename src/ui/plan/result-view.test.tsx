import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanRequest } from "@/planner/schema";
import { ResultView } from "@/ui/plan/result-view";
import {
  BOND_AS_CASH_PLAN,
  INSUFFICIENT_HISTORY_PLAN,
  LEVEL1_BOND_AS_CASH_PLAN,
  LEVEL1_PLAN,
  LEVEL3_PLAN,
  RESERVE_ONLY_PLAN,
} from "@/ui/test/plan-fixture";
import { DISCLAIMER } from "@/ui/today/view-model";

const REQUEST: PlanRequest = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 600000,
  monthly: 15000,
  monthlyExpenses: 30000,
  existingReserve: 90000,
};

const EXPLANATION = <p>說明槽</p>;
const HISTORY = <p>歷史槽</p>;

function renderView(
  plan: Parameters<typeof ResultView>[0]["plan"],
  options: { lens?: "beginner" | "pro"; request?: PlanRequest } = {},
) {
  return render(
    <ResultView
      plan={plan}
      request={options.request ?? REQUEST}
      lens={options.lens ?? "beginner"}
      explanation={EXPLANATION}
      history={HISTORY}
    />,
  );
}

describe("ResultView", () => {
  it("shows every card and both slots for a plan", () => {
    renderView(LEVEL3_PLAN);
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(screen.getByText("緊急預備金 90,000 元 已備齊")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
    expect(screen.getByText("說明槽")).toBeTruthy();
    expect(screen.getByText("歷史槽")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "試算前提" })).toBeTruthy();
  });

  it("lists the API assumptions and each fixed sentence exactly once", () => {
    renderView(LEVEL3_PLAN);
    for (const text of LEVEL3_PLAN.assumptions) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getAllByText("過去表現不代表未來。")).toHaveLength(1);
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("orders the cards for a phone and puts the right column in the sticky wrapper", () => {
    renderView(LEVEL3_PLAN);
    // The nearest ancestor that carries an order-N class.
    const orderOf = (el: HTMLElement) => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const match = /(?:^|\s)order-(\d+)(?:\s|$)/.exec(node.className);
        if (match) return Number(match[1]);
      }
      return Number.NaN;
    };
    const sequence = [
      screen.getByRole("region", { name: "風險等級" }),
      screen.getByRole("region", { name: "緊急預備金" }),
      screen.getByRole("heading", { name: /怎麼分/ }),
      screen.getByRole("heading", { name: "投入節奏" }),
      screen.getByText("說明槽"),
      screen.getByText("歷史槽"),
      screen.getByRole("heading", { name: "試算前提" }),
    ].map(orderOf);
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    expect(new Set(sequence).size).toBe(sequence.length);
    const right = screen.getByTestId("result-right");
    expect(right.className).toContain("md:sticky");
    expect(right.contains(screen.getByText("說明槽"))).toBe(true);
    expect(right.contains(screen.getByText("3 平衡"))).toBe(true);
    expect(right.contains(screen.getByText("歷史槽"))).toBe(false);
    expect(screen.getByTestId("result-left").contains(screen.getByText("歷史槽"))).toBe(true);
  });

  it("shows the honest note for level 1", () => {
    renderView(LEVEL1_PLAN);
    expect(screen.getByText(/這個等級有 55% 放在債券 ETF（元大美債20年，00679B）/)).toBeTruthy();
    expect(screen.queryByText("衛星")).toBeNull();
  });

  it("does not show the bond note when the bond slice is cash", () => {
    renderView(LEVEL1_BOND_AS_CASH_PLAN);
    expect(screen.queryByText(/這個等級有/)).toBeNull();
  });

  it("shows the horizon-cap note in the profile card", () => {
    renderView({ ...LEVEL3_PLAN, profile: { ...LEVEL3_PLAN.profile, cappedByHorizon: true } });
    const profile = screen.getByRole("region", { name: "風險等級" });
    expect(profile.textContent).toContain(
      "這筆錢可能在幾年內要用，所以配置被限制在比較保守的範圍。",
    );
  });

  it("shows the bond warning above the allocation", () => {
    renderView(BOND_AS_CASH_PLAN);
    const warning = screen.getByText("債券標的暫時沒有符合條件的 ETF，債券部位以現金計算");
    const heading = screen.getByRole("heading", { name: /怎麼分/ });
    expect(
      warning.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(warning.closest("[role=status]")?.className).toContain("bg-warn");
  });

  it("shows only the reserve plan, the profile and the fixed sentences when the reserve is short", () => {
    renderView(RESERVE_ONLY_PLAN, { request: { ...REQUEST, lump: 20000, monthly: 10000 } });
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(screen.getByText("緊急預備金 90,000 元 還差 50,000 元")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("先把緊急預備金補齊");
    expect(screen.queryByText(/怎麼分/)).toBeNull();
    expect(screen.queryByText("投入節奏")).toBeNull();
    expect(screen.queryByText("歷史槽")).toBeNull();
    expect(screen.queryByText(/過去這樣做/)).toBeNull();
    expect(screen.getAllByText("過去表現不代表未來。")).toHaveLength(1);
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("keeps the explanation slot with the reserve-only plan", () => {
    renderView(RESERVE_ONLY_PLAN, { request: { ...REQUEST, lump: 20000, monthly: 10000 } });
    expect(screen.getByText("說明槽")).toBeTruthy();
  });

  it("shows allocation, rhythm and a warn notice, but no history, with too little history", () => {
    renderView(INSUFFICIENT_HISTORY_PLAN);
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
    expect(screen.getByText("說明槽")).toBeTruthy();
    expect(screen.queryByText("歷史槽")).toBeNull();
    const warn = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.includes("歷史資料還不夠"));
    expect(warn?.className).toContain("bg-warn");
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("changes labels with the lens without losing the data", () => {
    const { rerender } = renderView(LEVEL3_PLAN, { lens: "beginner" });
    expect(screen.getByText(/你的處境能承受的風險是 4/)).toBeTruthy();
    rerender(
      <ResultView
        plan={LEVEL3_PLAN}
        request={REQUEST}
        lens="pro"
        explanation={EXPLANATION}
        history={HISTORY}
      />,
    );
    expect(screen.queryByText(/你的處境/)).toBeNull();
    expect(screen.getByText(/承受能力 4（第 1–4 題平均）/)).toBeTruthy();
    expect(screen.getByText("270,000 元")).toBeTruthy();
    expect(screen.getByText("歷史槽")).toBeTruthy();
  });

  it("renders without slots", () => {
    render(<ResultView plan={LEVEL3_PLAN} request={REQUEST} lens="beginner" />);
    expect(screen.queryByText("說明槽")).toBeNull();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
  });
});
