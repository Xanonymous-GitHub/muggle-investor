import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryChart, HistoryTooltip, valueAxis, yearTicks } from "@/ui/plan/history-chart";
import { historyView } from "@/ui/plan/view-model";
import { giveChartsASize } from "@/ui/test/chart-size";
import { matchEveryQuery } from "@/ui/test/match-media";
import { LEVEL3_PLAN } from "@/ui/test/plan-fixture";

// Every <Line> the chart renders reports its props here, then renders the real Recharts line.
const lineProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  const { createElement } = await import("react");
  function Line(props: Record<string, unknown>) {
    lineProps.push(props);
    return createElement(actual.Line as never, props);
  }
  return { ...actual, Line };
});

const main = historyView(LEVEL3_PLAN, "main");
const equity = historyView(LEVEL3_PLAN, "equity");
if (!main || !equity) throw new Error("fixture has both runs");

let restoreSize: () => void;
beforeEach(() => {
  restoreSize = giveChartsASize();
});
afterEach(() => {
  restoreSize();
  lineProps.length = 0;
});

const point = (value: number, invested = 0) => ({
  date: "2020-01-31",
  lump: value,
  dca: value,
  plan: value,
  invested,
});

describe("valueAxis", () => {
  it("counts in millions from a million up, to one decimal", () => {
    const axis = valueAxis([point(2_370_000), point(7_417_103)]);
    expect(axis.unit).toBe("million");
    expect(axis.format(7_000_000)).toBe("7");
    expect(axis.format(2_500_000)).toBe("2.5");
  });

  it("counts in 萬 below a million, so small sums do not all read 0", () => {
    const axis = valueAxis([point(30_000, 50_000), point(52_000, 50_000)]);
    expect(axis.unit).toBe("wan");
    expect(axis.format(0)).toBe("0");
    expect(axis.format(10_000)).toBe("1");
    expect(axis.format(50_000)).toBe("5");
    expect(axis.format(2_500)).toBe("0.25");
  });

  it("takes the maximum over every line, the invested total included", () => {
    expect(valueAxis([point(400_000, 1_200_000)]).unit).toBe("million");
    expect(valueAxis([point(400_000, 900_000)]).unit).toBe("wan");
  });

  it("widens the axis with the longest label, never below 36px", () => {
    expect(valueAxis([point(5_000_000)]).width).toBe(36);
    expect(valueAxis([point(1_234_000_000_000)]).width).toBeGreaterThan(36);
  });
});

describe("HistoryChart", () => {
  it("renders four lines without throwing, hidden from assistive technology", () => {
    const { container } = render(
      <HistoryChart series={main.series} lens="beginner" trancheMonths={6} />,
    );
    const root = container.querySelector("[data-slot=history-chart]");
    expect(root?.getAttribute("aria-hidden")).toBe("true");
    expect(new Set(lineProps.map((p) => p.dataKey))).toEqual(
      new Set(["plan", "lump", "dca", "invested"]),
    );
    expect(container.querySelectorAll("path.recharts-line-curve")).toHaveLength(4);
  });

  it("names the four lines per lens in an HTML legend", () => {
    const { container, unmount } = render(
      <HistoryChart series={main.series} lens="beginner" trancheMonths={6} />,
    );
    const legend = container.querySelector("[data-slot=history-legend]");
    expect(legend?.textContent).toBe("一次投入分 12 個月依建議（6 個月）累計投入的錢");
    unmount();
    const pro = render(<HistoryChart series={main.series} lens="pro" trancheMonths={6} />);
    expect(pro.container.querySelector("[data-slot=history-legend]")?.textContent).toBe(
      "一次投入分 12 個月依建議（6 個月）累計投入",
    );
    expect(screen.getByText("單位：百萬元")).toBeTruthy();
  });

  it("names the unit by the size of the sums", () => {
    render(
      <HistoryChart
        series={[point(10_000, 50_000), { ...point(40_000, 50_000), date: "2020-02-29" }]}
        lens="beginner"
        trancheMonths={1}
      />,
    );
    expect(screen.getByText("單位：萬元")).toBeTruthy();
    expect(screen.queryByText("單位：百萬元")).toBeNull();
  });

  it("leaves no focus stop and no application role inside the hidden picture", () => {
    const { container } = render(
      <HistoryChart series={main.series} lens="beginner" trancheMonths={6} />,
    );
    const root = container.querySelector("[data-slot=history-chart]") as HTMLElement;
    expect(root.querySelector("svg")).not.toBeNull();
    for (const el of root.querySelectorAll("[tabindex]")) {
      expect(el.getAttribute("tabindex")).toBe("-1");
    }
    expect(root.querySelector("[role=application]")).toBeNull();
  });

  it("draws the plan line last", () => {
    render(<HistoryChart series={main.series} lens="beginner" trancheMonths={6} />);
    expect(lineProps.slice(0, 4).map((p) => p.dataKey)).toEqual([
      "invested",
      "lump",
      "dca",
      "plan",
    ]);
  });

  it("draws the plan thick, no dots, and invested as a dotted step line", () => {
    render(<HistoryChart series={main.series} lens="beginner" trancheMonths={6} />);
    const byKey = new Map(lineProps.map((p) => [p.dataKey, p]));
    const plan = byKey.get("plan");
    const lump = byKey.get("lump");
    const invested = byKey.get("invested");
    expect(Number(plan?.strokeWidth)).toBeGreaterThan(Number(lump?.strokeWidth));
    for (const p of lineProps) expect(p.dot).toBe(false);
    expect(invested?.type).toBe("stepAfter");
    expect(invested?.strokeDasharray).toBeTruthy();
  });

  it("animates by default", () => {
    render(<HistoryChart series={main.series} lens="beginner" trancheMonths={6} />);
    expect(lineProps.at(-1)?.isAnimationActive).toBe(true);
  });

  it("turns animation off under prefers-reduced-motion", () => {
    const restore = matchEveryQuery();
    try {
      render(<HistoryChart series={main.series} lens="beginner" trancheMonths={6} />);
      const last = lineProps.slice(-4);
      expect(last).toHaveLength(4);
      for (const p of last) expect(p.isAnimationActive).toBe(false);
    } finally {
      restore();
    }
  });
});

describe("HistoryTooltip", () => {
  const names = {
    plan: "依建議（6 個月）",
    lump: "一次投入",
    dca: "分 12 個月",
    invested: "累計投入",
  };
  const point = main.series[3];
  if (!point) throw new Error("fixture has a fourth point");

  it("lists the hovered date, the three values and the invested total", () => {
    const { container } = render(
      <HistoryTooltip active payload={[{ payload: point }]} names={names} />,
    );
    expect(container.textContent).toBe(
      "2021-03-31一次投入2,159,749 元分 12 個月2,096,624 元依建議（6 個月）2,137,958 元累計投入1,365,000 元",
    );
  });

  it("renders nothing when not hovering", () => {
    const { container } = render(<HistoryTooltip active={false} payload={[]} names={names} />);
    expect(container.textContent).toBe("");
  });
});

describe("yearTicks", () => {
  it("ticks even years on a window of 12 years or less", () => {
    // 2026-10-14 is the series end itself, so it is dropped (see below).
    expect(yearTicks(main.series)).toEqual(["2018-05-31", "2022-07-29"]);
  });

  it("drops a last tick within six months of the series end, so it cannot clip", () => {
    const at = (date: string) => ({ date, lump: 1, dca: 1, plan: 1, invested: 1 });
    const near = ["2019-01-31", "2020-01-31", "2020-06-30"].map(at);
    expect(yearTicks(near)).toEqual([]);
    const far = ["2019-01-31", "2020-01-31", "2020-07-31"].map(at);
    expect(yearTicks(far)).toEqual(["2020-01-31"]);
  });

  it("ticks every fourth year on a longer window", () => {
    // The trimmed fixture has no point in 2008, 2012, 2016 or 2020.
    expect(yearTicks(equity.series)).toEqual(["2024-02-29"]);
  });

  it("ticks the first point of each chosen year only", () => {
    const series = ["2020-01-31", "2020-02-28", "2021-01-29", "2022-01-31", "2022-08-31"].map(
      (date) => ({ date, lump: 1, dca: 1, plan: 1, invested: 1 }),
    );
    expect(yearTicks(series)).toEqual(["2020-01-31", "2022-01-31"]);
  });

  it("is empty for an empty series", () => {
    expect(yearTicks([])).toEqual([]);
  });
});
