import { describe, expect, it } from "vitest";
import {
  formatDataDate,
  formatDataLine,
  formatInt,
  formatPct,
  formatSigned,
  formatYi,
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

describe("date formatting", () => {
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
