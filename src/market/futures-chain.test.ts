import { describe, expect, it } from "vitest";
import { futuresChainBreaks, nextWeekday } from "./futures-chain";

type Day = { tradeDate: string; futures: { close: number; change: number } | null };

const day = (tradeDate: string, close: number, change: number): Day => ({
  tradeDate,
  futures: { close, change },
});

describe("nextWeekday", () => {
  it("steps over the weekend and keeps ordinary days one apart", () => {
    expect(nextWeekday("2026-10-12")).toBe("2026-10-13");
    expect(nextWeekday("2026-10-09")).toBe("2026-10-12");
    expect(nextWeekday("2026-10-10")).toBe("2026-10-12");
  });
});

describe("futuresChainBreaks", () => {
  it("is false when the later close minus its change is the earlier close", () => {
    expect(futuresChainBreaks([day("2026-10-12", 20000, 100), day("2026-10-13", 20150, 150)])).toBe(
      false,
    );
  });

  it("is true when adjacent days are 1,349 points apart", () => {
    expect(futuresChainBreaks([day("2026-10-12", 20000, 100), day("2026-10-13", 21500, 151)])).toBe(
      true,
    );
  });

  it("is false for Friday to Monday when chained", () => {
    expect(futuresChainBreaks([day("2026-10-09", 20000, 100), day("2026-10-12", 20050, 50)])).toBe(
      false,
    );
  });

  it("does not check days that are not adjacent weekdays", () => {
    expect(futuresChainBreaks([day("2026-10-12", 20000, 100), day("2026-10-15", 25000, 10)])).toBe(
      false,
    );
  });

  it("breaks nothing for a day without futures between two days", () => {
    expect(
      futuresChainBreaks([
        day("2026-10-12", 20000, 100),
        { tradeDate: "2026-10-13", futures: null },
        day("2026-10-14", 30000, 10),
      ]),
    ).toBe(false);
  });

  it("allows a 0.5 gap and breaks on 0.6", () => {
    expect(
      futuresChainBreaks([day("2026-10-12", 20000, 100), day("2026-10-13", 20100.5, 100)]),
    ).toBe(false);
    expect(
      futuresChainBreaks([day("2026-10-12", 20000, 100), day("2026-10-13", 20100.6, 100)]),
    ).toBe(true);
  });
});
