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
  MONTHLY_ONLY_PLAN,
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
    expect(screen.getByText("90,000 元 已備齊")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
    expect(screen.getByText("說明槽")).toBeTruthy();
    expect(screen.getByText("歷史槽")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "試算前提" })).toBeTruthy();
  });

  it("lists the API assumptions once and each fixed sentence exactly once", () => {
    renderView(LEVEL3_PLAN);
    for (const text of LEVEL3_PLAN.assumptions) {
      // The API's own 「過去表現不代表未來」 is the fixed sentence: it prints once, with its 。.
      if (text === "過去表現不代表未來") continue;
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getAllByText(/過去表現不代表未來/)).toHaveLength(1);
    expect(screen.getAllByText("過去表現不代表未來。")).toHaveLength(1);
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("keeps DOM order equal to reading order, and uses no order or contents utilities", () => {
    const { container } = renderView(LEVEL3_PLAN);
    const sequence = [
      screen.getByRole("region", { name: "風險等級" }),
      screen.getByRole("region", { name: "緊急預備金" }),
      screen.getByRole("heading", { name: /怎麼分/ }),
      screen.getByRole("heading", { name: "投入節奏" }),
      screen.getByText("歷史槽"),
      screen.getByText("說明槽"),
      screen.getByRole("heading", { name: "試算前提" }),
    ];
    sequence.slice(1).forEach((el, i) => {
      const before = sequence[i] as HTMLElement;
      expect(before.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    const tokens = [...container.querySelectorAll("[class]")].flatMap((el) =>
      el.className.split(/\s+/),
    );
    expect(tokens.filter((t) => /(^|:)order-/.test(t) || /(^|:)contents$/.test(t))).toEqual([]);
  });

  it("scrolls both columns with the page: nothing is pinned or scrolls inside", () => {
    const { container } = renderView(LEVEL3_PLAN);
    const tokens = [...container.querySelectorAll("[class]")].flatMap((el) =>
      el.className.split(/\s+/),
    );
    expect(tokens.filter((t) => /(^|:)(sticky|fixed)$|max-h-|overflow-y-/.test(t))).toEqual([]);
    expect(container.querySelector("[data-testid=result-right]")).toBeNull();
  });

  it("places the groups on the desktop grid: profile top right, left group spanning", () => {
    renderView(LEVEL3_PLAN);
    const profile = screen.getByRole("region", { name: "風險等級" }).parentElement as HTMLElement;
    const left = screen.getByText("歷史槽").parentElement as HTMLElement;
    const right = screen.getByText("說明槽").parentElement as HTMLElement;
    expect(profile.className).toContain("lg:col-start-2");
    expect(profile.className).toContain("lg:row-start-1");
    expect(left.className).toContain("lg:row-span-2");
    expect(left.contains(screen.getByText("歷史槽"))).toBe(true);
    expect(right.className).toContain("lg:row-start-2");
    expect(right.contains(screen.getByRole("heading", { name: "試算前提" }))).toBe(true);
    expect(left.contains(screen.getByText("說明槽"))).toBe(false);
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
    expect(warning.parentElement?.className).toContain("bg-warn");
  });

  it("shows only the reserve plan, the profile and the fixed sentences when the reserve is short", () => {
    renderView(RESERVE_ONLY_PLAN, { request: { ...REQUEST, lump: 20000, monthly: 10000 } });
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(screen.getByText("90,000 元 還差 50,000 元")).toBeTruthy();
    expect(screen.getByText("先把緊急預備金補齊")).toBeTruthy();
    expect(screen.queryByText(/怎麼分/)).toBeNull();
    expect(screen.queryByText("投入節奏")).toBeNull();
    expect(screen.queryByText("歷史槽")).toBeNull();
    expect(screen.queryByText(/過去這樣做/)).toBeNull();
    expect(screen.getAllByText("過去表現不代表未來。")).toHaveLength(1);
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("leaves out the explanation slot with the reserve-only plan", () => {
    renderView(RESERVE_ONLY_PLAN, { request: { ...REQUEST, lump: 20000, monthly: 10000 } });
    expect(screen.queryByText("說明槽")).toBeNull();
  });

  it("shows allocation, rhythm and a warn notice, but no history, with too little history", () => {
    renderView(INSUFFICIENT_HISTORY_PLAN);
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
    expect(screen.queryByText("說明槽")).toBeNull();
    expect(screen.queryByText("歷史槽")).toBeNull();
    const warn = screen.getByText("歷史資料還不夠").parentElement;
    expect(warn?.className).toContain("bg-warn");
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("shows the monthly split and a single rhythm line for a saver with no lump to invest", () => {
    renderView(MONTHLY_ONLY_PLAN, { request: { ...REQUEST, lump: 0, monthly: 10000 } });
    expect(screen.getByRole("heading", { name: "每月 10,000 元怎麼分" })).toBeTruthy();
    expect(screen.getByText("4,500 元")).toBeTruthy();
    expect(screen.getByRole("img", { name: /配置比例：核心：市值型 ETF 45%/ })).toBeTruthy();
    expect(screen.getByText("第 1 個月起")).toBeTruthy();
    expect(screen.getByText("每個月投入 10,000 元")).toBeTruthy();
    expect(screen.queryByText(/一次投入 0 元/)).toBeNull();
    expect(screen.queryByText(/^0 元怎麼分/)).toBeNull();
  });

  it("changes labels with the lens without remounting the data", () => {
    const { rerender } = renderView(LEVEL3_PLAN, { lens: "beginner" });
    expect(screen.getByText(/你的處境能承受的風險是 4/)).toBeTruthy();
    const amount = screen.getByText("270,000 元");
    const slot = screen.getByText("歷史槽");
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
    // The same DOM nodes: the lens changed text, nothing was remounted.
    expect(screen.getByText("270,000 元")).toBe(amount);
    expect(screen.getByText("歷史槽")).toBe(slot);
  });

  it("renders without slots", () => {
    render(<ResultView plan={LEVEL3_PLAN} request={REQUEST} lens="beginner" />);
    expect(screen.queryByText("說明槽")).toBeNull();
    expect(screen.getByRole("heading", { name: "投入節奏" })).toBeTruthy();
  });
});
