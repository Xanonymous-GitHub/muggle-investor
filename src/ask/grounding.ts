/**
 * Checks an Ask answer against the evidence of its own run. Advisory and narrow on purpose: it
 * compares the numbers and the links the answer writes with what this run's tools returned. It
 * cannot tell whether a sentence means what the data means, so an answer with no issues is
 * "nothing found by these checks", never "verified". Pure: no server, db or env imports.
 *
 * What counts as grounding, in order of authority:
 * - the run's evidence ledger (tool results of this run) and the profile's own figures;
 * - the user's earlier words: a figure only they state is reported as `userStated`, not accepted
 *   as market data (a typed price is an assertion);
 * - earlier assistant messages never ground anything: the client can send any text with the
 *   assistant role, and the server keeps no record of what it really said.
 */
import type { AskVerification, FigureIssueKind } from "./ask-message";
import { type EvidenceFact, type EvidenceLedger, urlsIn } from "./evidence";
import { extractNumberTokens, type NumberToken } from "./numbers";
import { rememberSupportedByUser, splitRememberLine } from "./remember";
import { type AskRequest, privateValues } from "./schema";
import {
  collectNumbers,
  extractNumbers,
  findUnsupportedNumbers,
  isCheckedToken,
  matchesDirectly,
} from "./verify";

const RISE = /上漲|漲幅|漲了|上揚|走高|成長|增加|獲利|上升|攀升|賺|漲/u;
const FALL = /下跌|跌幅|跌了|走低|衰退|減少|虧損|下滑|回落|下降|重挫|虧|跌/u;
/** Metrics stored as sizes (a drawdown, a spread): their sign is not a direction. */
const MAGNITUDE_METRIC = /drawdown|volatility|worst/i;
const CURRENCY_OR_POINTS = /^\s?(?:元|點|股|張|塊|NT|TWD)/u;
const CLAUSE_BREAK = /[，,。；;\n]/u;

/**
 * Words a sentence uses for the metrics the built-in tools return. Only these metrics are bound
 * by meaning; for any other metric (or an external result) the check says nothing about it.
 */
const METRIC_CUES: Readonly<Record<string, RegExp>> = {
  changePct: /漲跌|漲幅|跌幅|當日|今日|單日/u,
  return1mPct: /一個月|1\s?個月|近月|一月/u,
  return3mPct: /三個月|3\s?個月|一季|近季/u,
  return1yPct: /一年|1\s?年|年報酬/u,
  return3yPct: /三年|3\s?年/u,
  maxDrawdownPct: /回撤/u,
  volatilityPct: /波動/u,
  lastClose: /收盤|收在|報價|股價/u,
  marketTurnover: /成交/u,
};

type Issue = { figure: string; kind: FigureIssueKind };

/** A bare 4-6 digit integer with no unit: a ticker code (0050, 2330), not a figure. */
const looksLikeCode = (token: NumberToken): boolean =>
  token.bareInteger && /^\d{4,6}$/.test(token.raw) && !CURRENCY_OR_POINTS.test(token.after);

const sign = (value: number): -1 | 0 | 1 => (value > 0 ? 1 : value < 0 ? -1 : 0);

/** The clause (between breaks) and the line of `text` around index `at`. */
function around(text: string, at: number, length: number): { clause: string; line: string } {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const lineEndAt = text.indexOf("\n", at + length);
  const line = text.slice(lineStart, lineEndAt === -1 ? text.length : lineEndAt);
  let from = at;
  while (from > lineStart && !CLAUSE_BREAK.test(text[from - 1] ?? "")) from--;
  let to = at + length;
  while (to < text.length && !CLAUSE_BREAK.test(text[to] ?? "")) to++;
  return { clause: text.slice(from, to), line };
}

/** Dates a line writes, as `MM-DD` (and a year when it gives one). */
function mentionedDates(line: string): { year: string | null; monthDay: string }[] {
  const out: { year: string | null; monthDay: string }[] = [];
  const pad = (n: string) => n.padStart(2, "0");
  for (const m of line.matchAll(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/gu)) {
    out.push({ year: m[1] ?? null, monthDay: `${pad(m[2] ?? "")}-${pad(m[3] ?? "")}` });
  }
  for (const m of line.matchAll(/(?<![\d./])(\d{1,2})\/(\d{1,2})(?![\d/])/gu)) {
    out.push({ year: null, monthDay: `${pad(m[1] ?? "")}-${pad(m[2] ?? "")}` });
  }
  for (const m of line.matchAll(/(\d{1,2})\s?月\s?(\d{1,2})\s?[日號号]/gu)) {
    out.push({ year: null, monthDay: `${pad(m[1] ?? "")}-${pad(m[2] ?? "")}` });
  }
  return out;
}

const hasDate = (fact: EvidenceFact, mention: { year: string | null; monthDay: string }) => {
  const date = fact.dataDate ?? "";
  return (
    date.endsWith(`-${mention.monthDay}`) &&
    (mention.year === null || date.startsWith(mention.year))
  );
};

/** How a figure that some evidence value equals is bound to the sentence that states it. */
function bindingIssue(
  text: string,
  token: NumberToken,
  matched: EvidenceFact[],
  subjects: readonly string[],
): FigureIssueKind | null {
  const { clause, line } = around(text, token.index, token.raw.length);

  // Unit: a percentage read off an amount or count, or an amount/points read off a percentage.
  if (token.percent && matched.every((f) => f.unit === "amount" || f.unit === "count")) {
    return "unit";
  }
  if (CURRENCY_OR_POINTS.test(token.after) && matched.every((f) => f.unit === "percent")) {
    return "unit";
  }

  // Direction: the clause says up/down, every evidence value of this size says the opposite.
  if (!matched.some((f) => MAGNITUDE_METRIC.test(f.metric))) {
    const rise = RISE.test(clause);
    const fall = FALL.test(clause);
    const explicitNegative = /^[-−]/u.test(token.raw);
    const claim = explicitNegative ? -1 : rise === fall ? 0 : rise ? 1 : -1;
    if (claim !== 0) {
      const signs = new Set(matched.map((f) => sign(f.value)));
      if (!signs.has(0) && !signs.has(claim)) return "sign";
    }
  }

  // Metric: the clause talks about one of the known metrics (a one-year return) while the matching
  // values are another (the maximum drawdown).
  const matchedMetrics = new Set(matched.map((f) => f.metric));
  if ([...matchedMetrics].every((metric) => metric in METRIC_CUES)) {
    const ownCue = [...matchedMetrics].some((metric) => METRIC_CUES[metric]?.test(clause));
    const otherCue = Object.entries(METRIC_CUES).some(
      ([metric, cue]) => !matchedMetrics.has(metric) && cue.test(clause),
    );
    if (!ownCue && otherCue) return "metric";
  }

  // Subject: the line names an instrument or sector the evidence knows, but the matching values
  // belong to others. A line naming nothing known cannot be told apart, so it passes.
  if (matched.every((f) => f.subjects.length > 0)) {
    const own = new Set(matched.flatMap((f) => f.subjects));
    const lower = line.toLowerCase();
    const mentionsOwn = [...own].some((name) => lower.includes(name.toLowerCase()));
    if (!mentionsOwn) {
      const others = subjects.filter(
        (name) => !own.has(name) && lower.includes(name.toLowerCase()),
      );
      if (others.length > 0) return "subject";
    }
  }

  // Date: the line gives exactly one date and no matching value carries it.
  const dates = mentionedDates(line);
  const first = dates[0];
  if (first && dates.every((d) => d.monthDay === first.monthDay)) {
    const dated = matched.filter((f) => f.dataDate !== null);
    if (dated.length === matched.length && !dated.some((f) => hasDate(f, first))) return "date";
  }
  return null;
}

/** Figures the answer states that a number of the evidence equals, with how each is bound. */
function bindingIssues(text: string, ledger: EvidenceLedger, skip: ReadonlySet<string>): Issue[] {
  if (ledger.facts.length === 0) return [];
  const subjects = ledger.subjects();
  const issues: Issue[] = [];
  for (const token of extractNumberTokens(text, { skipDates: true })) {
    if (!isCheckedToken(token) || looksLikeCode(token) || skip.has(token.raw)) continue;
    const matched = ledger.facts.filter(
      (fact) =>
        matchesDirectly(token, fact.value) ||
        (token.percent && matchesDirectly(token, fact.value * 100)),
    );
    // Nothing equal: the figure is derived or comes from the profile; the derivation check owns it.
    if (matched.length === 0) continue;
    const kind = bindingIssue(text, token, matched, subjects);
    if (kind !== null) issues.push({ figure: token.raw, kind });
  }
  return issues;
}

type Input = {
  text: string;
  request: Pick<AskRequest, "profile" | "messages">;
  ledger: EvidenceLedger;
};

/** The verification of one answer. May throw (the caller reports `checked: false`). */
export function verifyAnswer({ text, request, ledger }: Input): AskVerification {
  const { profile, messages } = request;
  // The profile's figures first: derivation reads only the first groups, and they must never be
  // the ones dropped.
  const profileGroup = [...privateValues(profile).numbers, ...collectNumbers(profile)];
  const userGroup = messages
    .filter((m) => m.role === "user")
    .flatMap((m) => extractNumbers(m.content));
  const historyGroup = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => extractNumbers(m.content));

  // A code the evidence or the profile names (2330) identifies something; it is not a figure.
  const codes = new Set([...ledger.subjects(), ...profile.holdings.map((h) => h.symbol)]);
  const notEvidenced = findUnsupportedNumbers(text, [profileGroup, ...ledger.groups()]).filter(
    (figure) => !codes.has(figure),
  );
  const notUserStated = new Set(findUnsupportedNumbers(text, [userGroup]));
  const notInHistory = new Set(findUnsupportedNumbers(text, [historyGroup]));

  // A bare 4-6 digit integer with no unit is usually a ticker code the user typed (0050, 2330),
  // not a figure they assert.
  const tokens = new Map(extractNumberTokens(text, { skipDates: true }).map((t) => [t.raw, t]));
  const isCode = (figure: string): boolean => {
    const token = tokens.get(figure);
    return token !== undefined && looksLikeCode(token);
  };
  const userStated = notEvidenced.filter((figure) => !notUserStated.has(figure) && !isCode(figure));
  const issues: Issue[] = notEvidenced
    .filter((figure) => notUserStated.has(figure))
    .map((figure) => ({
      figure,
      kind: notInHistory.has(figure) ? "unsupported" : "history_only",
    }));

  const skip = new Set(notEvidenced);
  const seen = new Set(issues.map((i) => `${i.kind}\n${i.figure}`));
  for (const issue of bindingIssues(text, ledger, skip)) {
    const key = `${issue.kind}\n${issue.figure}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }

  const known = ledger.urls();
  const unverifiedLinks = [...new Set(urlsIn(text))].filter((url) => !known.has(url));

  const proposal = splitRememberLine(text).remember;
  return {
    unsupported: [...new Set(issues.map((i) => i.figure))],
    checked: true,
    userStated,
    issues,
    unverifiedLinks,
    evidence: ledger.summary(),
    ...(proposal !== null && { rememberSupported: rememberSupportedByUser(proposal, messages) }),
  };
}
