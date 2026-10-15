// Signed-off instrument categories and eligibility thresholds (spec 「標的清單」 and 補充決定).

export const CATEGORY_MEMBERS: Record<"core" | "bond" | "dividend", readonly string[]> = {
  core: ["0050", "006208", "0051", "006203", "00922"],
  bond: ["00679B", "00687B", "00696B", "00720B", "00725B", "00751B", "00772B"],
  dividend: ["0056", "00878", "00919", "00713", "00929", "00940", "00900", "00915", "00731"],
};

export const ELIGIBILITY = {
  /** Latest trade must be within this many days. */
  maxStaleDays: 10,
  /** Minimum years of price history per category. */
  minHistoryYears: { core: 5, dividend: 5, bond: 3 },
  /** Minimum median daily turnover (TWD) over the recent window. */
  minMedianTurnover: 100_000_000,
  /** Recent window length in trading days. */
  recentDays: 120,
  /**
   * Leveraged, inverse, futures, currency and commodity names are excluded. Futures ETFs are
   * named with a leading 期 (期元大S&P石油); 期 elsewhere (短期公債) is not a marker. `+R` marks
   * the RMB-traded share classes.
   */
  excludedNamePattern:
    /^期|正2|反1|槓桿|反向|期貨|美元|人民幣|RMB|黃金|原油|石油|白銀|銅|黃豆|ETN|VIX|比特|虛擬|\+R/,
  /** TWSE symbol suffixes: L leveraged, R inverse, U futures or commodity. */
  excludedSymbolPattern: /[LRU]$/,
} as const;
