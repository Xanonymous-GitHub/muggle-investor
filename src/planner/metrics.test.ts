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
