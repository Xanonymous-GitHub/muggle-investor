// Testing Library collapses whitespace before matching text. The chart is a picture (aria-hidden);
// these tests read the table, the metrics and the window sentence, never the SVG.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryCard } from "@/ui/plan/history-card";
import type { PlanOk } from "@/ui/plan/view-model";
import { giveChartsASize } from "@/ui/test/chart-size";
import {
  BOND_AS_CASH_PLAN,
  DIVIDEND_AS_CASH_PLAN,
  LEVEL3_PLAN,
  MONTHLY_ONLY_PLAN,
  NULL_METRICS_PLAN,
} from "@/ui/test/plan-fixture";

const SHORT = "期間太短，無法計算";

function cellTexts(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "");
}

describe("HistoryCard", () => {
  // happy-dom has no layout; without a size every chart measures 0 x 0 and Recharts warns on stderr.
  let restore: () => void;
  beforeEach(() => {
    restore = giveChartsASize();
  });
  afterEach(() => restore());

  it("shows both tabs for a plan with an equity-only run", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByRole("tab", { name: "建議配置" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "只有股票" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "建議配置", selected: true })).toBeTruthy();
  });

  it("titles the card per lens", () => {
    const { unmount } = render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByRole("region", { name: "過去這樣做會怎樣" })).toBeTruthy();
    unmount();
    render(<HistoryCard plan={LEVEL3_PLAN} lens="pro" />);
    expect(screen.getByRole("region", { name: "歷史試算" })).toBeTruthy();
  });

  it("prints the main window with the bond note, and the three scenarios", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(
      screen.getByText("2017-01-17 至 2026-10-14，共 9.7 年（受債券 ETF 的上市時間限制）"),
    ).toBeTruthy();
    const cells = cellTexts(screen.getByRole("table"));
    expect(cells.filter((t) => t === "2,370,000")).toHaveLength(3);
    for (const value of ["7,417,103", "7,262,254", "7,363,648", "+17.92%", "+18.01%", "+17.98%"]) {
      expect(cells).toContain(value);
    }
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual([
      "投入方式",
      "一次投入",
      "分 12 個月",
      "依建議（6 個月）",
    ]);
    expect(screen.getByRole("columnheader", { name: "投入總額（元）" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "期末市值（元）" })).toBeTruthy();
    expect(screen.getByText("三種方式放進去的總錢數一樣，只差在放的時間。")).toBeTruthy();
  });

  it("colours returns red up and the drawdown green down, each with its sign", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="pro" />);
    expect(screen.getByText("+17.98%").className).toContain("text-up");
    const drawdown = screen.getByText("-27.19%");
    expect(drawdown.className).toContain("text-down");
    expect(screen.getByText("-22.11%").className).toContain("text-down");
  });

  it("switches window, table and metrics together to the equity-only run", async () => {
    const user = userEvent.setup();
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    await user.click(screen.getByRole("tab", { name: "只有股票" }));
    expect(
      screen.getByText("2007-12-26 至 2026-10-14，共 18.8 年（只有核心與高股息，沒有債券和現金）"),
    ).toBeTruthy();
    expect(screen.queryByText(/2017-01-17/)).toBeNull();
    const cells = cellTexts(screen.getByRole("table"));
    expect(cells.filter((t) => t === "4,005,000")).toHaveLength(3);
    expect(cells).toContain("32,280,517");
    expect(screen.getByText("-52.63%")).toBeTruthy();
    expect(screen.queryByText("7,363,648")).toBeNull();
    expect(screen.queryByText("-27.19%")).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("omits the bond note when the plan holds no bond slice", () => {
    render(<HistoryCard plan={BOND_AS_CASH_PLAN} lens="beginner" />);
    expect(screen.getByText("2017-01-17 至 2026-10-14，共 9.7 年")).toBeTruthy();
  });

  it("leaves out the bond note when the bond does not shorten the window", () => {
    // Bond held, but the equity-only run starts the same day: something else sets the window.
    const sameStart: PlanOk = {
      ...LEVEL3_PLAN,
      equityOnly: LEVEL3_PLAN.equityOnly && {
        ...LEVEL3_PLAN.equityOnly,
        from: LEVEL3_PLAN.window.from,
      },
    };
    const { unmount } = render(<HistoryCard plan={sameStart} lens="beginner" />);
    expect(screen.getByText("2017-01-17 至 2026-10-14，共 9.7 年")).toBeTruthy();
    expect(screen.queryByText(/受債券 ETF/)).toBeNull();
    unmount();
    // No equity-only run at all: nothing proves the bond is the limit.
    render(<HistoryCard plan={NULL_METRICS_PLAN} lens="beginner" />);
    expect(screen.queryByText(/受債券 ETF/)).toBeNull();
  });

  describe("with no lump to invest (monthly only)", () => {
    const SAME = "三種方式放進去的總錢數一樣，只差在放的時間。";
    const NO_LUMP = "沒有一次投入的錢，三種投入方式的結果相同，這裡只列一次。";

    it("lists one row, the plan run, labelled 每月投入", () => {
      render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="beginner" />);
      const rows = within(screen.getByRole("table")).getAllByRole("row");
      expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["投入方式", "每月投入"]);
      expect(cellTexts(screen.getByRole("table"))).toContain("7,363,648");
      expect(screen.queryByText("一次投入")).toBeNull();
      expect(screen.queryByText(/分 12 個月/)).toBeNull();
      expect(screen.queryByText(/依建議/)).toBeNull();
    });

    it("says why there is one row instead of the three-way sentence", () => {
      render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="beginner" />);
      expect(screen.getByText(NO_LUMP)).toBeTruthy();
      expect(screen.queryByText(SAME)).toBeNull();
    });

    it("names the row 定期定額 for the pro lens", () => {
      render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="pro" />);
      const rows = within(screen.getByRole("table")).getAllByRole("row");
      expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["投入方式", "定期定額"]);
    });

    it("keeps the chart legend to the plan and the invested total", () => {
      const { container } = render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="beginner" />);
      expect(container.querySelector("[data-slot=history-legend]")?.textContent).toBe(
        "每月投入累計投入的錢",
      );
    });

    it("gives the equity-only tab the same single row and sentence", async () => {
      const user = userEvent.setup();
      render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="beginner" />);
      await user.click(screen.getByRole("tab", { name: "只有股票" }));
      const rows = within(screen.getByRole("table")).getAllByRole("row");
      expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["投入方式", "每月投入"]);
      expect(screen.getByText(NO_LUMP)).toBeTruthy();
      expect(screen.queryByText(SAME)).toBeNull();
    });

    it("still says the bond limits the window, from the weights not the zero slices", () => {
      render(<HistoryCard plan={MONTHLY_ONLY_PLAN} lens="beginner" />);
      expect(
        screen.getByText("2017-01-17 至 2026-10-14，共 9.7 年（受債券 ETF 的上市時間限制）"),
      ).toBeTruthy();
    });

    it("keeps all three rows and the sentence when there is a lump", () => {
      render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
      expect(screen.getByText(SAME)).toBeTruthy();
      expect(screen.queryByText(NO_LUMP)).toBeNull();
      expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
    });
  });

  it("has no tabs without an equity-only run", () => {
    render(<HistoryCard plan={NULL_METRICS_PLAN} lens="beginner" />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("shows — with a reason for a null xirr and a null worst year", () => {
    render(<HistoryCard plan={NULL_METRICS_PLAN} lens="beginner" />);
    const unknown = screen.getAllByTitle(SHORT);
    // Three xirr cells and the worst year.
    expect(unknown).toHaveLength(4);
    for (const el of unknown) expect(el.textContent).toBe(`—${SHORT}`);
    expect(within(unknown[0] as HTMLElement).getByText(SHORT).className).toContain("sr-only");
  });

  it("uses the professional terms in the pro lens", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="pro" />);
    expect(screen.getByRole("columnheader", { name: "XIRR" })).toBeTruthy();
    expect(screen.getByText("最大回撤")).toBeTruthy();
    expect(screen.getByText("最差滾動十二個月")).toBeTruthy();
    expect(screen.getByText("年化波動度")).toBeTruthy();
    expect(screen.queryByText("換算成每年")).toBeNull();
  });

  it("uses plain words in the beginner lens", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(screen.getByRole("columnheader", { name: "換算成每年" })).toBeTruthy();
    expect(screen.getByText("最深曾經跌")).toBeTruthy();
    expect(screen.getByText("最差的連續一年")).toBeTruthy();
    expect(screen.queryByText("最大回撤")).toBeNull();
  });

  it("prints the volatility without a sign or a trend colour", () => {
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    const volatility = screen.getByText("13.16%");
    expect(volatility.className).not.toContain("text-up");
    expect(volatility.className).not.toContain("text-down");
  });

  it("hides the chart from assistive technology; the table carries its facts", () => {
    const { container } = render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    const chart = container.querySelector("[data-slot=history-chart]");
    expect(chart).not.toBeNull();
    expect(chart?.getAttribute("aria-hidden")).toBe("true");
    // Nothing inside the picture is reachable by role.
    for (const role of ["table", "heading", "tab", "img"] as const) {
      for (const el of screen.queryAllByRole(role)) expect(chart?.contains(el)).toBe(false);
    }
  });

  it("names the equity-only run core alone when the plan has no dividend ETF", async () => {
    const user = userEvent.setup();
    render(<HistoryCard plan={DIVIDEND_AS_CASH_PLAN} lens="beginner" />);
    await user.click(screen.getByRole("tab", { name: "只有股票" }));
    expect(
      screen.getByText("2007-12-26 至 2026-10-14，共 18.8 年（只有核心，沒有債券和現金）"),
    ).toBeTruthy();
    expect(screen.queryByText(/高股息/)).toBeNull();
  });

  it("ties each table to its own window through its caption", async () => {
    const user = userEvent.setup();
    render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
    expect(
      screen.getByRole("table", {
        name: "三種投入方式比較，2017-01-17 至 2026-10-14，共 9.7 年（受債券 ETF 的上市時間限制）",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "只有股票" }));
    expect(
      screen.getByRole("table", {
        name: "三種投入方式比較，2007-12-26 至 2026-10-14，共 18.8 年（只有核心與高股息，沒有債券和現金）",
      }),
    ).toBeTruthy();
  });

  describe("with a drawn chart", () => {
    it("never moves keyboard focus into the chart", async () => {
      const user = userEvent.setup();
      const { container } = render(<HistoryCard plan={LEVEL3_PLAN} lens="beginner" />);
      const chart = container.querySelector("[data-slot=history-chart]") as HTMLElement;
      expect(chart.querySelector("svg")).not.toBeNull();
      screen.getByRole("tab", { name: "建議配置", selected: true }).focus();
      const visited: Element[] = [];
      for (let i = 0; i < 6; i++) {
        await user.tab();
        if (document.activeElement === document.body) break;
        visited.push(document.activeElement as Element);
      }
      expect(visited.length).toBeGreaterThan(0);
      for (const el of visited) expect(chart.contains(el)).toBe(false);
      // The panel itself follows the tab list; the chart inside it is skipped.
      expect(visited[0]?.getAttribute("role")).toBe("tabpanel");
    });
  });
});
