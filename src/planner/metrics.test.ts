import { describe, expect, it } from "vitest";
import { annualVolatility, cagr, maxDrawdown, worstRollingYear, xirr } from "./metrics";

describe("xirr", () => {
  it("solves a single in-and-out pair over 731 days", () => {
    // 2020-01-01 → 2022-01-01 is 731 days (2020 is a leap year), so on actual/365
    // 1000 × (1 + r)^(731/365) = 1210 → r = 1.21^(365/731) − 1 ≈ 0.09986, i.e. ≈ 10 %.
    const r = xirr([
      { date: "2020-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 1210 },
    ]);
    expect(r).toBeCloseTo(1.21 ** (365 / 731) - 1, 6);
    expect(r).toBeCloseTo(0.1, 2);
  });

  it("solves two contributions with a known closed form", () => {
    // 2021-01-01, 2022-01-01 (+365 d), 2023-01-01 (+730 d). At r = 0.1:
    // 1000 × 1.1² + 1000 × 1.1 = 1210 + 1100 = 2310, so the flows below have r = 0.1 exactly.
    const r = xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: -1000 },
      { date: "2023-01-01", amount: 2310 },
    ]);
    expect(r).toBeCloseTo(0.1, 9);
  });

  it("solves a loss", () => {
    // 1000 in, 500 back one 365-day year later → −50 %.
    const r = xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 500 },
    ]);
    expect(r).toBeCloseTo(-0.5, 9);
  });

  it("returns 0 when the money comes back unchanged", () => {
    const r = xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2021-06-01", amount: -1000 },
      { date: "2022-01-01", amount: 2000 },
    ]);
    expect(r).toBeCloseTo(0, 9);
  });

  it("is null when every flow has one sign", () => {
    expect(
      xirr([
        { date: "2021-01-01", amount: -1000 },
        { date: "2022-01-01", amount: -500 },
      ]),
    ).toBeNull();
    expect(xirr([{ date: "2021-01-01", amount: 1000 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });
});

describe("cagr", () => {
  it("annualises on actual/365", () => {
    // 121 / 100 = 1.21 over 730 days = 2 years → √1.21 − 1 = 0.1.
    expect(cagr(100, 121, 730)).toBeCloseTo(0.1, 12);
  });

  it("is null for non-positive values or less than one day", () => {
    expect(cagr(0, 121, 730)).toBeNull();
    expect(cagr(100, 0, 730)).toBeNull();
    expect(cagr(-1, 121, 730)).toBeNull();
    expect(cagr(100, 121, 0)).toBeNull();
  });
});

describe("maxDrawdown", () => {
  it("measures the deepest fall from a running peak", () => {
    // Peak 1.2, trough 0.9 → 0.9 / 1.2 − 1 = −0.25.
    expect(maxDrawdown([1, 1.2, 0.9, 1.5])).toBeCloseTo(-0.25, 12);
  });

  it("is 0 for a rising series and an empty one", () => {
    expect(maxDrawdown([1, 1.1, 1.2, 1.3])).toBe(0);
    expect(maxDrawdown([])).toBe(0);
  });
});

describe("annualVolatility", () => {
  it("is 0 for a constant series and for fewer than 2 values", () => {
    expect(annualVolatility([5, 5, 5, 5])).toBe(0);
    expect(annualVolatility([5])).toBe(0);
    expect(annualVolatility([])).toBe(0);
  });

  it("is the population standard deviation of daily returns × √252", () => {
    // Values 100 → 110 → 99 → 108.9: returns +0.1, −0.1, +0.1; mean = 0.1 / 3.
    // Deviations 0.2/3, −0.4/3, 0.2/3; squares 0.04/9, 0.16/9, 0.04/9; sum 0.24/9.
    // Variance = (0.24/9) / 3 = 0.08/9; σ = √(0.08/9) ≈ 0.0942809; × √252 ≈ 1.4966630.
    const expected = Math.sqrt(0.08 / 9) * Math.sqrt(252);
    expect(annualVolatility([100, 110, 99, 108.9])).toBeCloseTo(expected, 9);
    expect(expected).toBeCloseTo(1.496663, 6);
  });
});

describe("worstRollingYear", () => {
  it("finds the worst return from any point to the first point one year later", () => {
    // Half-yearly points over three years. One-year windows:
    //   2020-01 → 2021-01: 90 / 100 − 1 = −0.10
    //   2020-07 → 2021-07: 96 / 120 − 1 = −0.20   ← worst
    //   2021-01 → 2022-01: 110 / 90 − 1 ≈ +0.222
    //   2021-07 → 2022-07: 99 / 96 − 1 ≈ +0.031
    //   2022-01 → 2023-01: 120 / 110 − 1 ≈ +0.091
    //   2022-07 → (no point a year later)
    const points = [
      { date: "2020-01-01", value: 100 },
      { date: "2020-07-01", value: 120 },
      { date: "2021-01-01", value: 90 },
      { date: "2021-07-01", value: 96 },
      { date: "2022-01-01", value: 110 },
      { date: "2022-07-01", value: 99 },
      { date: "2023-01-01", value: 120 },
    ];
    expect(worstRollingYear(points)).toBeCloseTo(-0.2, 12);
  });

  it("uses the first point on or after the anniversary when it is missing", () => {
    // 2020-03-02 + 1 year = 2021-03-02 is missing, so the window ends at 2021-03-05 (80 / 100 − 1).
    // From 2020-06-01 there is no point on or after 2021-06-01.
    const points = [
      { date: "2020-03-02", value: 100 },
      { date: "2020-06-01", value: 70 },
      { date: "2021-03-01", value: 60 },
      { date: "2021-03-05", value: 80 },
    ];
    expect(worstRollingYear(points)).toBeCloseTo(-0.2, 12);
  });

  it("is null for a series shorter than a year", () => {
    expect(
      worstRollingYear([
        { date: "2021-01-01", value: 100 },
        { date: "2021-12-31", value: 50 },
      ]),
    ).toBeNull();
    expect(worstRollingYear([])).toBeNull();
  });
});

// Fix round 1: XIRR on long and losing DCA flows, compared against an independent reference.
const monthDate = (k: number) => new Date(Date.UTC(2000, k, 1)).toISOString().slice(0, 10);
/** n monthly −1000 flows from 2000-01-01, then the final value mult × invested one month later. */
const dcaFlows = (n: number, mult: number) => [
  ...Array.from({ length: n }, (_, k) => ({ date: monthDate(k), amount: -1000 })),
  { date: monthDate(n), amount: 1000 * n * mult },
];
/** Reference: plain bisection on the present-value form, actual/365, on (−0.9999, 10). */
function referenceXirr(flows: readonly { date: string; amount: number }[]): number {
  const t0 = Date.parse(flows[0]?.date ?? "");
  const npv = (r: number) =>
    flows.reduce(
      (acc, f) => acc + f.amount * (1 + r) ** (-(Date.parse(f.date) - t0) / 86_400_000 / 365),
      0,
    );
  let lo = -0.9999;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

describe("xirr on long and losing DCA flows", () => {
  it("is ≈ 0 for 20 years of monthly 1000 returned unchanged", () => {
    expect(xirr(dcaFlows(240, 1))).toBeCloseTo(0, 6);
  });

  it("is slightly negative / positive for 240 months at 0.99× / 1.01×", () => {
    const down = xirr(dcaFlows(240, 0.99));
    const up = xirr(dcaFlows(240, 1.01));
    expect(down).toBeCloseTo(referenceXirr(dcaFlows(240, 0.99)), 6);
    expect(up).toBeCloseTo(referenceXirr(dcaFlows(240, 1.01)), 6);
    expect(down).toBeLessThan(0);
    expect(up).toBeGreaterThan(0);
  });

  it("solves a 10-year DCA losing 40 %, 60 months at 0.5× and 12 months at 0.3×", () => {
    for (const [n, mult] of [
      [120, 0.6],
      [60, 0.5],
      [12, 0.3],
    ] as const) {
      const r = xirr(dcaFlows(n, mult));
      expect(r).not.toBeNull();
      expect(r).toBeCloseTo(referenceXirr(dcaFlows(n, mult)), 6);
      expect(r).toBeLessThan(0);
    }
  });

  it("finds a root near −99 %", () => {
    // 1000 in, 10 back after 365 days → 10 / 1000 − 1 = −0.99.
    const r = xirr([
      { date: "2021-01-01", amount: -1000 },
      { date: "2022-01-01", amount: 10 },
    ]);
    expect(r).toBeCloseTo(-0.99, 9);
  });

  it("does not depend on flow order", () => {
    const flows = dcaFlows(36, 1.2);
    expect(xirr([...flows].reverse())).toBeCloseTo(xirr(flows) as number, 12);
  });

  it("matches the reference bisection on a deterministic mini-fuzz", () => {
    // Linear congruential generator with a fixed seed: 25 cases of 2–300 months, 0.3×–3×.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 25; i++) {
      const n = 2 + Math.floor(next() * 299);
      const mult = 0.3 + next() * 2.7;
      const flows = dcaFlows(n, mult);
      expect(xirr(flows), `n=${n} mult=${mult}`).toBeCloseTo(referenceXirr(flows), 6);
    }
  });

  it("is null for non-finite input", () => {
    expect(
      xirr([
        { date: "2021-01-01", amount: -1000 },
        { date: "2022-01-01", amount: Number.NaN },
        { date: "2022-01-02", amount: 10 },
      ]),
    ).toBeNull();
  });
});

describe("float noise", () => {
  it("snaps metric outputs within 1e-12 of zero to exactly 0", () => {
    expect(maxDrawdown([1, 1 - 3e-16, 1])).toBe(0);
    expect(annualVolatility([1, 1 + 2e-16, 1, 1 - 2e-16])).toBe(0);
    expect(
      worstRollingYear([
        { date: "2021-01-01", value: 1 },
        { date: "2022-01-01", value: 1 - 2e-16 },
      ]),
    ).toBe(0);
    expect(cagr(1, 1 - 2e-16, 365)).toBe(0);
  });
});
