// Built-in read-only data tools handed to the model by the Ask service. Each tool is a thin
// adapter over an existing service or repository; nothing here writes or reaches the network.
// Every result is capped at MAX_RESULT_BYTES and its numbers are pushed to `groundedSink` as one
// group, so the answer verifier can tell figures that came from data from ones the model made up.
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { AskRequest } from "@/ask/schema";
import { collectNumbers } from "@/ask/verify";
import type { Db } from "@/db/client";
import { BriefingDriftError, latestBriefing } from "@/db/repositories/briefings";
import { listEtfUniverse } from "@/db/repositories/etf-universe";
import { getCorporateActions, getPriceBars } from "@/db/repositories/prices";
import { GLOSSARY, type GlossaryTerm } from "@/glossary";
import { LENSES } from "@/insight/lens";
import { weekRange } from "@/insight/week";
import { logger } from "@/lib/logger";
import { getToday, getSectorBoard as loadSectorBoard } from "@/market/market-service";
import { toTaipei } from "@/market-clock/market-clock";
import { maxDrawdown } from "@/planner/metrics";
import { DataUnavailableError, planPortfolio } from "@/planner/plan-service";
import type { Slice } from "@/planner/rules/allocation";
import { LEVEL_NAMES } from "@/planner/rules/levels";
import type { PlanBacktest, PlanResponse } from "@/planner/schema";
import { buildTotalReturnIndex } from "@/planner/total-return";

/** Serialized (UTF-8) size every tool result must stay under. */
export const MAX_RESULT_BYTES = 8 * 1024;

const DEFAULT_SECTOR_LIMIT = 10;
/** An error code worth logging (a Postgres or Node code); anything else could carry text. */
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;
const MAX_SECTOR_LIMIT = 30;
const MAX_TERM_MATCHES = 3;
const TOP_MOVERS = 5;
/** The lists getMarketToday may shorten to fit; everything else in it is kept whole. */
const MOVER_LISTS = ["topGainers", "topLosers", "netBuy", "netSell"] as const;
const EARLIEST = "1900-01-01";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

type Json = Record<string, unknown>;

/** The array at a dotted path of plain objects ("sectors", "board.rows"), when there is one. */
function listAt(root: Json, path: string): unknown[] | undefined {
  let node: unknown = root;
  for (const key of path.split(".")) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Json)[key];
  }
  return Array.isArray(node) ? node : undefined;
}

/**
 * Keeps a tool result within MAX_RESULT_BYTES by dropping items from the end of the largest of
 * the lists the tool names as `truncatable` (dotted paths, most relevant item first), then setting
 * `truncated: true`. Nothing else is ever cut: a result that is still too large once those lists
 * are empty (or when it names none) becomes `{ error: "result_too_large" }`.
 */
export function capResult<T extends Json>(
  result: T,
  truncatable: readonly string[],
): T | { error: "result_too_large" } {
  if (bytes(result) <= MAX_RESULT_BYTES) return result;
  const copy = structuredClone(result) as Json;
  copy.truncated = true;
  while (bytes(copy) > MAX_RESULT_BYTES) {
    const lists = truncatable
      .map((path) => listAt(copy, path))
      .filter((list): list is unknown[] => list !== undefined && list.length > 0);
    if (lists.length === 0) return { error: "result_too_large" };
    let largest = lists[0] as unknown[];
    for (const list of lists) if (bytes(list) > bytes(largest)) largest = list;
    largest.pop();
  }
  return copy as T;
}

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};
const pct = (ratio: number): number => round2(ratio * 100);
const pctOrNull = (ratio: number | null): number | null => (ratio === null ? null : pct(ratio));

/** `date` moved by whole months, clamped to the target month's last day (UTC calendar days). */
function shiftMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

const RETURN_PERIODS = [
  { key: "return1mPct", months: 1 },
  { key: "return3mPct", months: 3 },
  { key: "return1yPct", months: 12 },
  { key: "return3yPct", months: 36 },
] as const;

type Deps = {
  db: Db;
  now: Date;
  profile: AskRequest["profile"];
  groundedSink: number[][];
};

const termView = (term: GlossaryTerm) => ({
  id: term.id,
  term: term.term,
  aliases: term.aliases,
  category: term.category,
  beginner: term.beginner,
  pro: term.pro,
  related: term.related,
});

/** Id or exact name first, then names and aliases that contain the query or sit inside it. */
function findTerms(query: string): GlossaryTerm[] {
  const q = query.trim().toLowerCase();
  const names = (term: GlossaryTerm) => [term.term, ...term.aliases].map((n) => n.toLowerCase());
  const tiers: GlossaryTerm[][] = [
    GLOSSARY.filter((term) => term.id === q),
    GLOSSARY.filter((term) => names(term).includes(q)),
  ];
  if (q.length >= 2) {
    tiers.push(GLOSSARY.filter((term) => names(term).some((n) => n.includes(q) || q.includes(n))));
  }
  const seen = new Set<string>();
  const out: GlossaryTerm[] = [];
  for (const term of tiers.flat()) {
    if (seen.has(term.id)) continue;
    seen.add(term.id);
    out.push(term);
  }
  return out.slice(0, MAX_TERM_MATCHES);
}

const backtestMetrics = (b: PlanBacktest) => ({
  from: b.from,
  to: b.to,
  invested: b.invested,
  finalValue: b.finalValue,
  xirrPct: pctOrNull(b.xirr),
  cagrPct: pctOrNull(b.cagr),
  maxDrawdownPct: pct(b.maxDrawdown),
  volatilityPct: pct(b.volatility),
  worstYearPct: pctOrNull(b.worstYear),
});

const ALLOCATION_SLICES: readonly Slice[] = ["core", "bond", "dividend", "satellite", "cash"];

function planView(plan: PlanResponse): Json {
  const { profile, amounts } = plan;
  const instruments = plan.kind === "plan" ? plan.instruments : [];
  const allocation = ALLOCATION_SLICES.filter((slice) => amounts.weights[slice] > 0).map(
    (slice) => {
      const instrument = instruments.find((i) => i.category === slice);
      return {
        category: slice,
        weightPct: amounts.weights[slice],
        amount: amounts.slices[slice],
        ...(instrument && {
          symbol: instrument.symbol,
          name: instrument.name,
          alternate: instrument.alternate,
        }),
      };
    },
  );
  const view: Json = {
    kind: plan.kind,
    level: profile.level,
    levelName: LEVEL_NAMES[profile.level],
    capacity: profile.capacity,
    willingness: profile.willingness,
    cappedByHorizon: profile.cappedByHorizon,
    reserveFirst: profile.reserveFirst,
    reserve: {
      target: amounts.reserveTarget,
      gap: amounts.reserveGap,
      reserveOnly: amounts.reserveOnly,
      monthsToFill: amounts.monthsToFillReserve,
    },
    investable: amounts.investable,
    allocation,
    warnings: plan.warnings,
    assumptions: plan.assumptions,
  };
  if (plan.kind !== "plan") return view;
  const { lump, dca, plan: staged } = plan.scenarios;
  return {
    ...view,
    dataDate: plan.window.to,
    window: plan.window,
    trancheMonths: plan.rhythm.trancheMonths,
    metrics: {
      lump: backtestMetrics(lump),
      dca: backtestMetrics(dca),
      plan: backtestMetrics(staged),
    },
    equityOnly: plan.equityOnly && {
      from: plan.equityOnly.from,
      years: plan.equityOnly.years,
      metrics: {
        lump: backtestMetrics(plan.equityOnly.lump),
        dca: backtestMetrics(plan.equityOnly.dca),
        plan: backtestMetrics(plan.equityOnly.plan),
      },
    },
  };
}

export function createDataTools({ db, now, profile, groundedSink }: Deps): ToolSet {
  /** Caps the result, records its numbers as one grounding group, and returns it. */
  function finish<T extends Json>(result: T, truncatable: readonly string[] = []) {
    const capped = capResult(result, truncatable);
    groundedSink.push(collectNumbers(capped));
    return capped;
  }

  /**
   * An unexpected throw would reach the model as raw error text (SQL, paths). It becomes a
   * code-only error instead; the log carries the tool name and the error's string `code` only.
   */
  function guard<I>(name: string, run: (input: I) => Json | Promise<Json>) {
    return async (input: I): Promise<Json> => {
      try {
        return await run(input);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        logger.warn(
          { tool: name, ...(typeof code === "string" && SAFE_CODE.test(code) && { code }) },
          "ask data tool failed",
        );
        return finish({ error: "tool_failed" });
      }
    };
  }

  const getMarketToday = tool({
    description:
      "取得最新的大盤概況：最近一個收盤日的漲跌家數、力道、期貨、強弱類股、法人買賣超、四象限分布與提醒，以及最新類股表的資料日期。回答今天行情前先呼叫。",
    inputSchema: z.object({}),
    execute: guard("getMarketToday", async () => {
      const { digest, board, stale } = await getToday(db);
      if (!digest && !board) return finish({ error: "no_data" });
      return finish(
        {
          dataDate: digest?.tradeDate ?? board?.tradeDate,
          asOf: digest?.asOf ?? board?.asOf ?? null,
          session: digest?.session ?? board?.session,
          stale,
          market: digest && {
            force: digest.market.force,
            breadth: digest.market.breadth,
            upGroups: digest.market.upGroups,
            downGroups: digest.market.downGroups,
            futures: digest.market.futures,
            prev: digest.market.prev,
          },
          topGainers: digest?.topGainers?.slice(0, TOP_MOVERS).map(withoutRepresentatives) ?? null,
          topLosers: digest?.topLosers?.slice(0, TOP_MOVERS).map(withoutRepresentatives) ?? null,
          netBuy: digest?.netBuy?.slice(0, TOP_MOVERS) ?? null,
          netSell: digest?.netSell?.slice(0, TOP_MOVERS) ?? null,
          quadrantCounts: digest?.quadrant?.counts.today ?? null,
          caveats: digest?.caveats ?? [],
          board: board && {
            dataDate: board.tradeDate,
            asOf: board.asOf,
            session: board.session,
            marketTurnover: board.marketTurnover,
            sectorCount: board.sectors.length,
          },
        },
        MOVER_LISTS,
      );
    }),
  });

  const getSectorBoard = tool({
    description:
      "取得類股表現排行（當日漲跌、近一個月漲跌、成交值、漲跌家數、漲停跌停家數）。order 選 leaders 看最強，laggards 看最弱；limit 為筆數（1 到 30，預設 10）。",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(MAX_SECTOR_LIMIT).optional(),
      order: z.enum(["leaders", "laggards"]).optional(),
    }),
    execute: guard(
      "getSectorBoard",
      async ({ limit = DEFAULT_SECTOR_LIMIT, order = "leaders" }) => {
        const board = await loadSectorBoard(db);
        if (!board) return finish({ error: "no_data" });
        const sign = order === "leaders" ? -1 : 1;
        const sectors = [...board.sectors]
          .sort((a, b) => sign * (a.changePct - b.changePct) || a.rank - b.rank)
          .slice(0, limit);
        return finish(
          {
            dataDate: board.tradeDate,
            asOf: board.asOf,
            session: board.session,
            marketTurnover: board.marketTurnover,
            order,
            totalSectors: board.sectors.length,
            sectors,
          },
          ["sectors"],
        );
      },
    ),
  });

  const lookupTerm = tool({
    description:
      "查詢投資名詞：用名詞的代號、名稱或別名查，回傳新手版與進階版的說明，以及相關名詞的代號。",
    inputSchema: z.object({ query: z.string().trim().min(1).max(60) }),
    execute: guard("lookupTerm", ({ query }) => {
      const matches = findTerms(query);
      if (matches.length === 0) return finish({ error: "term_not_found" });
      return finish({ matches: matches.map(termView) }, ["matches"]);
    }),
  });

  const getInstrumentHistory = tool({
    description:
      "查詢追蹤清單內某檔 ETF 的歷史表現：資料涵蓋期間、最新收盤價、一個月／三個月／一年／三年報酬（含配息再投入，歷史不夠長則為空值）、期間最大回撤。symbol 為代號，例如 0050。",
    inputSchema: z.object({
      symbol: z
        .string()
        .trim()
        .regex(/^[0-9A-Za-z]{2,10}$/),
    }),
    execute: guard("getInstrumentHistory", async ({ symbol: input }) => {
      const symbol = input.toUpperCase();
      const universe = await listEtfUniverse(db);
      const listed = universe.find((row) => row.symbol === symbol);
      if (!listed) return finish({ error: "unknown_symbol" });
      const [bars, actions] = await Promise.all([
        getPriceBars(db, symbol, EARLIEST, toTaipei(now).date),
        getCorporateActions(db, symbol),
      ]);
      const index = buildTotalReturnIndex(bars, actions);
      const first = index[0];
      const last = index.at(-1);
      if (!first || !last) return finish({ error: "no_price_data" });

      const returns = Object.fromEntries(
        RETURN_PERIODS.map(({ key, months }) => {
          const target = shiftMonths(last.date, -months);
          const start = first.date <= target ? index.findLast((p) => p.date <= target) : undefined;
          return [key, start ? pct(last.index / start.index - 1) : null];
        }),
      );
      return finish({
        symbol,
        name: listed.name,
        firstDate: first.date,
        dataDate: last.date,
        barCount: bars.length,
        lastClose: bars.findLast((bar) => bar.date === last.date)?.close ?? null,
        ...returns,
        maxDrawdownPct: pct(maxDrawdown(index.map((p) => p.index))),
        basis: "含配息再投入的報酬；最大回撤涵蓋資料的整段期間",
      });
    }),
  });

  const getMyPlan = tool({
    description:
      "取得使用者目前的投資規劃：風險等級、各類配置比例與金額、緊急預備金、歷史試算區間與指標（一次投入、分批、依規則三種）。沒有規劃時會回報 no_plan。",
    inputSchema: z.object({}),
    execute: guard("getMyPlan", async () => {
      if (!profile.plan) return finish({ error: "no_plan" });
      try {
        return finish(planView(await planPortfolio({ db, now }, profile.plan)));
      } catch (error) {
        if (error instanceof DataUnavailableError) return finish({ error: "data_unavailable" });
        throw error;
      }
    }),
  });

  const getLatestBriefing = tool({
    description:
      "取得最新的每日或每週簡報（標題、摘要、各段內容、重點）。lens 為 beginner 或 pro。每週簡報的 periodFrom 與 periodTo 是該 ISO 週的日曆起訖日，不是交易日。",
    inputSchema: z.object({
      lens: z.enum(LENSES),
      kind: z.enum(["daily", "weekly"]),
    }),
    execute: guard("getLatestBriefing", async ({ lens, kind }) => {
      let briefing: Awaited<ReturnType<typeof latestBriefing>>;
      try {
        briefing = await latestBriefing(db, kind, lens);
      } catch (error) {
        if (!(error instanceof BriefingDriftError)) throw error;
        logger.warn({ kind, lens }, "stored briefing no longer matches its schema");
        return finish({ error: "no_briefing" });
      }
      if (!briefing) return finish({ error: "no_briefing" });
      const { content } = briefing;
      return finish(
        {
          kind: briefing.kind,
          lens: briefing.lens,
          periodKey: briefing.periodKey,
          ...period(briefing.kind, briefing.periodKey),
          headline: content.headline,
          summary: content.summary,
          sections: content.sections,
          takeaway: content.takeaway,
          termIds: content.termIds,
        },
        ["sections"],
      );
    }),
  });

  return {
    getMarketToday,
    getSectorBoard,
    lookupTerm,
    getInstrumentHistory,
    getMyPlan,
    getLatestBriefing,
  };
}

/**
 * A daily briefing's period is its data date. A weekly one has no single data date: it carries the
 * calendar bounds of its ISO week (Monday and Sunday), which are not trading days and may lie ahead.
 */
function period(kind: "daily" | "weekly", periodKey: string) {
  if (kind === "daily") return { dataDate: periodKey };
  const { from, to } = weekRange(periodKey);
  return { periodFrom: from, periodTo: to };
}

function withoutRepresentatives<T extends { representatives: unknown }>(
  mover: T,
): Omit<T, "representatives"> {
  const { representatives: _dropped, ...rest } = mover;
  return rest;
}
