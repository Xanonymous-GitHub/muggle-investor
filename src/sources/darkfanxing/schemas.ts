import { z } from "zod";
import type { ReportTable } from "./report-document";

/** Thrown by every darkfanxing parser; `section` names the report part that failed. */
export class DarkfanxingParseError extends Error {
  readonly section?: string;

  constructor(message: string, options: { section?: string; cause?: unknown } = {}) {
    super(options.section ? `[${options.section}] ${message}` : message, {
      cause: options.cause,
    });
    this.name = "DarkfanxingParseError";
    if (options.section !== undefined) this.section = options.section;
  }
}

/** Runs `fn`, rethrowing any non-DarkfanxingParseError as one attributed to `section`. */
export function inSection<T>(section: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof DarkfanxingParseError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new DarkfanxingParseError(message, { section, cause: error });
  }
}

/**
 * Throws unless the table has exactly `expected` headers and every row has that many cells,
 * so rows can be returned as tuples with one string per header.
 */
export function expectTable<const H extends readonly string[]>(
  table: ReportTable | undefined,
  expected: H,
  section: string,
): { [K in keyof H]: string }[] {
  if (!table) throw new DarkfanxingParseError("table missing", { section });
  if (table.headers.join("|") !== expected.join("|")) {
    throw new DarkfanxingParseError(
      `unexpected headers ${JSON.stringify(table.headers)}, expected ${JSON.stringify(expected)}`,
      { section },
    );
  }
  for (const row of table.rows) {
    if (row.length !== expected.length) {
      throw new DarkfanxingParseError(
        `row has ${row.length} cells, expected ${expected.length}: ${JSON.stringify(row)}`,
        { section },
      );
    }
  }
  return table.rows as { [K in keyof H]: string }[];
}

/** Validates `value` against `schema`, wrapping Zod failures in a DarkfanxingParseError. */
export function validate<S extends z.ZodType>(
  schema: S,
  value: unknown,
  label: string,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const summary = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new DarkfanxingParseError(`${label} failed validation: ${summary}`, {
    cause: result.error,
  });
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clockTime = z.string().regex(/^\d{2}:\d{2}$/);
const count = z.number().int().nonnegative();
const nullableNumber = z.number().nullable();

export const titleMetaSchema = z.object({
  tradeDate: isoDate,
  asOf: clockTime.nullable(),
  session: z.enum(["closed", "intraday", "unknown"]),
});

export const sectorRowSchema = z.object({
  rank: count,
  name: z.string().min(1),
  changePct: z.number(),
  advancers: count,
  decliners: count,
  unchanged: count,
  constituents: count,
  turnover: z.number().nonnegative(),
  turnoverRank: count,
  turnoverVsPrevPct: nullableNumber,
  limitUp: count,
  limitDown: count,
  change1mPct: nullableNumber,
});

export const sectorBoardSchema = titleMetaSchema.extend({
  marketTurnover: z
    .object({ today: z.number(), prevSameTime: z.number(), changePct: z.number() })
    .nullable(),
  sectors: z.array(sectorRowSchema).min(1),
});

export const sectorStockSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  changePct: z.number(),
  turnover: z.number().nonnegative(),
  turnoverVsPrevPct: nullableNumber,
  change1mPct: nullableNumber,
  noTrade: z.boolean(),
});

export const sectorDetailSchema = z.object({
  group: z.string().min(1),
  tradeDate: isoDate,
  asOf: clockTime.nullable(),
  changePct: z.number(),
  rank: count,
  rankOf: count,
  change1mPct: z.number(),
  stocks: z.array(sectorStockSchema),
});

export const quadrantSchema = z.enum(["強勢", "弱勢", "轉強", "轉弱"]);

export const quadrantCountsSchema = z.object({
  強勢: count,
  弱勢: count,
  轉強: count,
  轉弱: count,
});

export const moverSchema = z.object({ name: z.string().min(1), changePct: z.number() });

export const sectorMoverSchema = z.object({
  name: z.string().min(1),
  changePct: z.number(),
  change1mPct: nullableNumber,
  constituents: count,
  advancerRatioPct: z.number().min(0).max(100),
  limitUpLocked: count,
  limitDownLocked: count,
  representatives: z.array(moverSchema),
});

export const flowRowSchema = z.object({
  name: z.string().min(1),
  netFlow: z.number(),
  prevNetFlow: nullableNumber,
  turnover: z.number().nonnegative(),
  marketSharePct: z.number(),
  concentration: z.number(),
  changePct: z.number(),
});

const breadthStatsSchema = z.object({
  upGroups: count,
  downGroups: count,
  force: z.number(),
  breadth: z.number(),
});

const reportTableSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

const reportSectionSchema = z.object({
  heading: z.string(),
  level: z.union([z.literal(2), z.literal(3)]),
  items: z.array(z.string()),
  paragraphs: z.array(z.string()),
  tables: z.array(reportTableSchema),
});

export const digestSnapshotSchema = titleMetaSchema.extend({
  market: breadthStatsSchema.extend({
    futures: z
      .object({
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        change: z.number(),
        changePct: z.number(),
      })
      .nullable(),
    prev: breadthStatsSchema.nullable(),
  }),
  rhythm: z.array(
    breadthStatsSchema.extend({
      time: clockTime,
      leaders: z.array(moverSchema),
      laggers: z.array(moverSchema),
    }),
  ),
  topGainers: z.array(sectorMoverSchema).nullable(),
  topLosers: z.array(sectorMoverSchema).nullable(),
  netBuy: z.array(flowRowSchema).nullable(),
  netSell: z.array(flowRowSchema).nullable(),
  quadrant: z
    .object({
      counts: z.object({ today: quadrantCountsSchema, prev: quadrantCountsSchema.nullable() }),
      transitions: z.array(
        z.object({
          name: z.string().min(1),
          from: quadrantSchema,
          to: quadrantSchema,
          slope5d: z.number(),
          slope20d: z.number(),
          netFlowToday: z.number(),
        }),
      ),
      leaders: z.array(
        z.object({
          label: z.string().min(1),
          entries: z.array(
            z.object({
              name: z.string().min(1),
              slope5d: z.number(),
              slope20d: z.number(),
              quadrant: quadrantSchema,
            }),
          ),
        }),
      ),
    })
    .nullable(),
  limits: z
    .object({ summary: z.array(z.string()), tables: z.array(reportSectionSchema) })
    .nullable(),
  glossary: z.array(z.object({ term: z.string().min(1), definition: z.string().min(1) })),
  caveats: z.array(z.string()),
});

export type TitleMeta = z.infer<typeof titleMetaSchema>;
export type SectorRow = z.infer<typeof sectorRowSchema>;
export type SectorBoard = z.infer<typeof sectorBoardSchema>;
export type SectorDetail = z.infer<typeof sectorDetailSchema>;
export type Quadrant = z.infer<typeof quadrantSchema>;
export type QuadrantCounts = z.infer<typeof quadrantCountsSchema>;
export type Mover = z.infer<typeof moverSchema>;
export type SectorMover = z.infer<typeof sectorMoverSchema>;
export type FlowRow = z.infer<typeof flowRowSchema>;
export type DigestSnapshot = z.infer<typeof digestSnapshotSchema>;
