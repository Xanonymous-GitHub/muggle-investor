import { describe, expect, it } from "vitest";
import {
  formatDataDate,
  formatDataLine,
  formatInt,
  formatPct,
  formatRatio,
  formatSigned,
  formatUnsignedRatio,
  formatYi,
  ratioTrend,
  trendClass,
  trendOf,
} from "@/ui/format";

describe("trendOf / trendClass", () => {
  it("classifies by sign and maps to colour classes", () => {
    expect(trendOf(0.1)).toBe("up");
    expect(trendOf(-0.1)).toBe("down");
    expect(trendOf(0)).toBe("flat");
    expect(trendOf(-0)).toBe("flat");
    expect(trendClass("up")).toBe("text-up");
    expect(trendClass("down")).toBe("text-down");
    expect(trendClass("flat")).toBe("text-muted-foreground");
  });
});

describe("number formatting", () => {
  it("formatSigned always signs non-zero values with ASCII characters", () => {
    expect(formatSigned(3.9)).toBe("+3.90");
    expect(formatSigned(-2.8)).toBe("-2.80");
    expect(formatSigned(0)).toBe("0.00");
    expect(formatSigned(-0)).toBe("0.00");
    expect(formatSigned(3.9, 0)).toBe("+4");
  });

  it("formatSigned shows a value that rounds to zero as unsigned zero", () => {
    expect(formatSigned(-0.001)).toBe("0.00");
    expect(formatSigned(0.004)).toBe("0.00");
  });

  it("formatPct appends a percent sign", () => {
    expect(formatPct(3.9)).toBe("+3.90%");
    expect(formatPct(-1.24)).toBe("-1.24%");
    expect(formatPct(0)).toBe("0.00%");
  });

  it("formatYi appends the 億 unit", () => {
    expect(formatYi(57.44)).toBe("+57.44 億");
    expect(formatYi(-3)).toBe("-3.00 億");
  });

  it("formatInt groups thousands", () => {
    expect(formatInt(49349)).toBe("49,349");
    expect(formatInt(12)).toBe("12");
  });
});

describe("non-finite input", () => {
  it("prints a dash, never NaN or Infinity", () => {
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatSigned(n)).toBe("—");
      expect(formatPct(n)).toBe("—");
      expect(formatYi(n)).toBe("—");
      expect(formatInt(n)).toBe("—");
    }
  });
});

describe("date formatting", () => {
  it("formatDataDate returns a malformed date as is", () => {
    expect(formatDataDate("not-a-date")).toBe("not-a-date");
    expect(formatDataDate("")).toBe("");
    expect(formatDataLine({ tradeDate: "oops", session: "closed", asOf: null })).toBe(
      "資料日期 oops盤後",
    );
  });

  it("formatDataDate adds the weekday computed from the date string", () => {
    expect(formatDataDate("2026-10-08")).toBe("2026-10-08（四）");
    expect(formatDataDate("2026-10-04")).toBe("2026-10-04（日）");
    expect(formatDataDate("2026-10-10")).toBe("2026-10-10（六）");
  });

  it("formatDataLine states the session after the date", () => {
    expect(formatDataLine({ tradeDate: "2026-10-08", session: "closed", asOf: null })).toBe(
      "資料日期 2026-10-08（四）盤後",
    );
    expect(formatDataLine({ tradeDate: "2026-10-08", session: "intraday", asOf: "13:25" })).toBe(
      "資料日期 2026-10-08（四）盤中 13:25",
    );
    expect(formatDataLine({ tradeDate: "2026-10-08", session: "unknown", asOf: null })).toBe(
      "資料日期 2026-10-08（四）",
    );
  });
});

describe("formatRatio / ratioTrend", () => {
  it("prints a fraction as a signed percent", () => {
    expect(formatRatio(0.1792)).toBe("+17.92%");
    expect(formatRatio(-0.2719)).toBe("-27.19%");
    expect(formatRatio(0.1792, 1)).toBe("+17.9%");
    expect(formatRatio(0)).toBe("0.00%");
  });

  it("shows a value that rounds to zero as plain 0.00%", () => {
    expect(formatRatio(-0.00001)).toBe("0.00%");
    expect(formatRatio(0.00001)).toBe("0.00%");
  });

  it("rounds at the printed digit", () => {
    expect(formatRatio(0.00005)).toBe("+0.01%");
    expect(formatRatio(0.000049999)).toBe("0.00%");
    expect(formatRatio(-0.00005)).toBe("-0.01%");
    expect(formatRatio(-0.000049999)).toBe("0.00%");
  });

  it("supports zero digits", () => {
    expect(formatRatio(0.1792, 0)).toBe("+18%");
    expect(formatRatio(-0.2719, 0)).toBe("-27%");
    expect(formatRatio(0.004, 0)).toBe("0%");
    expect(formatRatio(-0.004, 0)).toBe("0%");
  });

  it("shows a dash for null and non-finite values", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(Number.NaN)).toBe("—");
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("takes the trend of the printed value", () => {
    expect(ratioTrend(0.1792)).toBe("up");
    expect(ratioTrend(-0.2719)).toBe("down");
    expect(ratioTrend(-0.00001)).toBe("flat");
    expect(ratioTrend(0.00001)).toBe("flat");
    expect(ratioTrend(null)).toBe("flat");
    expect(ratioTrend(Number.POSITIVE_INFINITY)).toBe("flat");
    expect(ratioTrend(Number.NEGATIVE_INFINITY)).toBe("flat");
    expect(ratioTrend(Number.NaN)).toBe("flat");
    expect(ratioTrend(0.00005)).toBe("up");
    expect(ratioTrend(0.000049999)).toBe("flat");
    expect(ratioTrend(0.004, 0)).toBe("flat");
    expect(ratioTrend(0.006, 0)).toBe("up");
  });
});

describe("formatUnsignedRatio", () => {
  it("prints a fraction as a percent without a sign", () => {
    expect(formatUnsignedRatio(0.13158)).toBe("13.16%");
    expect(formatUnsignedRatio(0.13158, 1)).toBe("13.2%");
    expect(formatUnsignedRatio(0)).toBe("0.00%");
  });

  it("drops the sign of a negative value", () => {
    expect(formatUnsignedRatio(-0.05)).toBe("5.00%");
  });

  it("shows — for null or a value that is not finite", () => {
    expect(formatUnsignedRatio(null)).toBe("—");
    expect(formatUnsignedRatio(Number.NaN)).toBe("—");
    expect(formatUnsignedRatio(Number.POSITIVE_INFINITY)).toBe("—");
  });
});
