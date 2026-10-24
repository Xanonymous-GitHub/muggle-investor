/**
 * The evidence ledger of one Ask run: what the tools actually returned, as bounded structured
 * facts (subject, metric, value, unit, data date) under a source record (tool, retrieval time,
 * data date / session / as-of, URLs seen, truncation and freshness warnings). Pure: no server, db
 * or env imports.
 *
 * Only a tool result recorded here during THIS run is evidence. The client never sends evidence
 * back (the server stores no conversation), so a figure from an earlier turn, a forged assistant
 * message or a user-stated price is never in the ledger; a factual follow-up has to fetch again.
 */
import { extractNumberTokens } from "./numbers";

export type EvidenceUnit = "percent" | "amount" | "count" | "other";

export type EvidenceSource = {
  /** `s1`, `s2`, ... in recording order. */
  id: string;
  /** The tool that produced it, `<server>__<tool>` for an external one. */
  tool: string;
  kind: "internal" | "external";
  /** When the run fetched it (the run's own clock, ISO). */
  retrievedAt: string;
  /** The result's own data date / as-of / session, when the result states them. */
  dataDate: string | null;
  asOf: string | null;
  session: string | null;
  /** http(s) URLs found in the result, normalized; at most MAX_URLS_PER_SOURCE. */
  urls: string[];
  /** The result was cut to fit a size cap, so facts after the cut are missing. */
  truncated: boolean;
  /** The tool reported an error or nothing (`{ error }`): there is no data behind it. */
  failed: boolean;
  warnings: string[];
};

export type EvidenceFact = {
  sourceId: string;
  /** Names that identify what the value is about (symbol, name, sector, ...), first is primary. */
  subjects: string[];
  /** The JSON key the value sat under (`changePct`, `return1yPct`, ...), or `text` inside a string. */
  metric: string;
  value: number;
  unit: EvidenceUnit;
  /** The nearest enclosing data date: a component of a combined result keeps its own date. */
  dataDate: string | null;
  /** The nearest enclosing session (`closed`, `intraday`, `series`, ...). */
  session: string | null;
};

export type EvidenceSummary = {
  /** Sources that returned data. */
  sources: number;
  /** Tools whose result held no data (an error or an empty answer). */
  failed: string[];
  truncated: boolean;
  warnings: string[];
};

/** Per source; a larger result keeps its first facts and is marked truncated. */
export const MAX_FACTS_PER_SOURCE = 1500;
/** Per run: bounds memory and the verifier's work whatever the tools return. */
export const MAX_FACTS_TOTAL = 6000;
export const MAX_SOURCES = 200;
const MAX_URLS_PER_SOURCE = 20;
const MAX_DEPTH = 24;
const MAX_ITEMS_PER_LIST = 200;

const SUBJECT_KEYS = ["symbol", "code", "name", "sector", "group", "term", "category"] as const;
const DATE_KEYS = ["dataDate", "tradeDate", "date"] as const;

const LABEL_KEYS: ReadonlySet<string> = new Set([...SUBJECT_KEYS, ...DATE_KEYS, "asOf", "session"]);

const PERCENT_METRIC = /pct$|percent|rate$|yield|ratio/i;
const AMOUNT_METRIC =
  /amount|invested|finalvalue|turnover|close|price|target|gap|investable|netbuy|netsell|value|cap$/i;
const COUNT_METRIC = /count|groups|bars|years|months|rank|^up$|^down$|limit(up|down)/i;

export function unitOfMetric(metric: string): EvidenceUnit {
  if (PERCENT_METRIC.test(metric)) return "percent";
  if (AMOUNT_METRIC.test(metric)) return "amount";
  if (COUNT_METRIC.test(metric)) return "count";
  return "other";
}

const URL_PATTERN = /https?:\/\/[^\s<>"'\])）」』}]+/giu;

/**
 * A URL reduced to what identifies the page: lowercase host without `www.`, path without a
 * trailing slash, query without `utm_*`, no fragment. Null for anything that is not a plain
 * http(s) URL with a host.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/[.,;:!?。，；：]+$/u, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
  const kept = [...url.searchParams].filter(([key]) => !key.toLowerCase().startsWith("utm_"));
  const query = new URLSearchParams(kept).toString();
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}${query === "" ? "" : `?${query}`}`;
}

/** The normalized URLs written in `text`. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const normalized = normalizeUrl(match[0]);
    if (normalized !== null) out.push(normalized);
  }
  return out;
}

type Walk = {
  subjects: string[];
  dataDate: string | null;
  session: string | null;
  metric: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringAt = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
};

export type RecordInput = {
  tool: string;
  kind: EvidenceSource["kind"];
  /** The JSON result as the tool returned it (what the model sees). */
  result: unknown;
  /** What to read facts from when the model sees a cut copy (the cut tail removed); default `result`. */
  readable?: unknown;
  truncated?: boolean;
  warnings?: string[];
};

export class EvidenceLedger {
  readonly sources: EvidenceSource[] = [];
  readonly facts: EvidenceFact[] = [];
  private readonly urlSet = new Set<string>();

  /** `now` is the run's clock; every source is stamped with it. */
  constructor(private readonly now: Date) {}

  record(input: RecordInput): EvidenceSource {
    const result = input.result;
    const root = isRecord(result) ? result : {};
    const failed = typeof root.error === "string";
    const source: EvidenceSource = {
      id: `s${this.sources.length + 1}`,
      tool: input.tool,
      kind: input.kind,
      retrievedAt: this.now.toISOString(),
      dataDate: stringAt(root, DATE_KEYS),
      asOf: typeof root.asOf === "string" ? root.asOf : null,
      session: typeof root.session === "string" ? root.session : null,
      urls: [],
      truncated: input.truncated === true || root.truncated === true,
      failed,
      warnings: [...(input.warnings ?? [])],
    };
    if (root.stale === true) source.warnings.push("stale");
    if (this.sources.length >= MAX_SOURCES) {
      // Past the cap nothing more is kept; the answer then cannot be checked against it.
      source.truncated = true;
      return source;
    }
    this.sources.push(source);
    if (!failed) this.collect(source, input.readable ?? result);
    return source;
  }

  private collect(source: EvidenceSource, value: unknown): void {
    let count = 0;
    const push = (fact: Omit<EvidenceFact, "sourceId">): void => {
      if (count >= MAX_FACTS_PER_SOURCE || this.facts.length >= MAX_FACTS_TOTAL) {
        source.truncated = true;
        return;
      }
      count += 1;
      this.facts.push({ sourceId: source.id, ...fact });
    };
    const start: Walk = {
      subjects: [],
      dataDate: source.dataDate,
      session: source.session,
      metric: "value",
    };
    const freshness = new Set<string>();
    const walk = (node: unknown, ctx: Walk, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      if (typeof node === "number") {
        if (Number.isFinite(node)) {
          push({
            subjects: ctx.subjects,
            metric: ctx.metric,
            value: node,
            unit: unitOfMetric(ctx.metric),
            dataDate: ctx.dataDate,
            session: ctx.session,
          });
        }
      } else if (typeof node === "string") {
        for (const url of urlsIn(node)) this.addUrl(source, url);
        // A name is a label ("元大台灣50"), not a figure; so are dates and time stamps.
        if (LABEL_KEYS.has(ctx.metric)) return;
        for (const token of extractNumberTokens(node, { skipDates: true })) {
          push({
            subjects: ctx.subjects,
            metric: "text",
            value: token.value,
            unit: token.percent ? "percent" : "other",
            dataDate: ctx.dataDate,
            session: ctx.session,
          });
        }
      } else if (Array.isArray(node)) {
        for (const item of node.slice(0, MAX_ITEMS_PER_LIST)) walk(item, ctx, depth + 1);
        if (node.length > MAX_ITEMS_PER_LIST) source.truncated = true;
      } else if (isRecord(node)) {
        const own = SUBJECT_KEYS.map((key) => node[key]).filter(
          (v): v is string => typeof v === "string" && v !== "",
        );
        const date = stringAt(node, DATE_KEYS);
        const here: Walk = {
          subjects: own.length > 0 ? own : ctx.subjects,
          dataDate: date ?? ctx.dataDate,
          session: typeof node.session === "string" ? node.session : ctx.session,
          metric: ctx.metric,
        };
        const state = isRecord(node.freshness) ? node.freshness.state : undefined;
        if (typeof state === "string") freshness.add(state);
        for (const [key, item] of Object.entries(node)) {
          walk(item, { ...here, metric: key }, depth + 1);
        }
      }
    };
    const sessions = new Set<string>();
    const dates = new Set<string>();
    walk(value, start, 0);
    for (const fact of this.facts.slice(-count)) {
      if (fact.session !== null) sessions.add(fact.session);
      if (fact.dataDate !== null) dates.add(fact.dataDate);
    }
    // One result mixing sessions or dates (a closed digest beside an intraday board) is not one
    // synchronized observation.
    if (sessions.size > 1 || dates.size > 1) source.warnings.push("mixed_session");
    if (freshness.has("behind")) source.warnings.push("stale");
    if (freshness.has("provisional")) source.warnings.push("provisional");
  }

  private addUrl(source: EvidenceSource, url: string): void {
    this.urlSet.add(url);
    if (source.urls.length < MAX_URLS_PER_SOURCE && !source.urls.includes(url)) {
      source.urls.push(url);
    }
  }

  /** Every URL some tool result of this run contained, normalized. */
  urls(): ReadonlySet<string> {
    return this.urlSet;
  }

  /** Per-source number groups for the verifier's same-source derivations. Failed sources have none. */
  groups(): number[][] {
    const bySource = new Map<string, number[]>();
    for (const fact of this.facts) {
      const list = bySource.get(fact.sourceId) ?? [];
      list.push(fact.value);
      bySource.set(fact.sourceId, list);
    }
    return this.sources.flatMap((source) => {
      const values = bySource.get(source.id);
      return values ? [values] : [];
    });
  }

  /** The distinct names the facts are about, longest first (so "0050" is not found inside "00500"). */
  subjects(): string[] {
    const names = new Set<string>();
    for (const fact of this.facts) for (const name of fact.subjects) names.add(name);
    return [...names].filter((name) => name.length >= 2).sort((a, b) => b.length - a.length);
  }

  summary(): EvidenceSummary {
    const warnings = new Set<string>();
    for (const source of this.sources) for (const warning of source.warnings) warnings.add(warning);
    return {
      sources: this.sources.filter((source) => !source.failed).length,
      failed: [...new Set(this.sources.filter((s) => s.failed).map((s) => s.tool))],
      truncated: this.sources.some((source) => source.truncated),
      warnings: [...warnings],
    };
  }
}
