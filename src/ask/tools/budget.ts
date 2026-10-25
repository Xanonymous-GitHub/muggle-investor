/**
 * The execution budget of one Ask request, shared by every tool plan the request tries (the
 * external-tools plan, the built-ins-only retry, the continuation fallback). The AI SDK's step cap
 * counts model steps; one step can still ask for dozens of tool calls, a slow tool can hold the
 * answer, and the model can ask for the same read again and again. This wrapper bounds all three
 * at the tool boundary:
 *
 * - total calls (`maxCalls`): later calls get `tool_limit_reached`;
 * - concurrency (`concurrency`): calls beyond it wait for a slot;
 * - time per call (`timeoutMs`) and the request's own signal: the call is abandoned with
 *   `tool_timeout` even when the tool ignores the signal;
 * - total result size (`maxResultBytes`): once the results already handed to the model reach it,
 *   later calls get `context_budget_exhausted` instead of growing the next prompt further;
 * - identical read calls: the second and later identical call (same tool, same canonical
 *   arguments) is answered from the first result without running again; after `maxRepeats` of
 *   them the model is told `repeated_call` and the run is marked as looping.
 *
 * Every refusal is a normal tool result, so the model reads it and answers with what it has. The
 * wrapped tools are read-only (the service only ever hands it read-only tools), which is why a
 * repeated call may be answered from the first result. Pure apart from the timers it starts.
 */
import type { ToolSet } from "ai";

export type BudgetLimits = {
  maxCalls: number;
  concurrency: number;
  timeoutMs: number;
  maxResultBytes: number;
};

export const DEFAULT_MAX_REPEATS = 3;

/** Why a call did not run (or did not finish), as the `error` code the model reads. */
export type BudgetRefusal =
  | "tool_limit_reached"
  | "context_budget_exhausted"
  | "repeated_call"
  | "tool_timeout"
  | "tool_aborted"
  | "tool_failed";

export type BudgetStats = {
  /** Calls that were started (a refused or reused call does not count). */
  executed: number;
  /** Calls answered from an identical earlier call. */
  reused: number;
  /** Calls refused by a limit, by reason. */
  refused: Partial<Record<BudgetRefusal, number>>;
  resultBytes: number;
  /** The model kept asking for the same read after being answered `maxRepeats` times. */
  looping: boolean;
};

export type Budget = {
  /** Wraps every executable tool of `tools`; the result shares this budget's counters. */
  wrap(tools: ToolSet): ToolSet;
  stats(): BudgetStats;
  /** The limit that stopped work, when one did: the first refusal reason that happened. */
  firstRefusal(): BudgetRefusal | null;
};

type Options = BudgetLimits & {
  /** The request's own signal (client gone, overall deadline). */
  signal?: AbortSignal;
  maxRepeats?: number;
  /** Told about every call that produced no data, so the evidence ledger can record it. */
  onRefusal?: (tool: string, reason: BudgetRefusal) => void;
};

/** Key order does not matter: `{a:1,b:2}` and `{b:2,a:1}` are the same call. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

const byteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "null").length;

const failure = (error: BudgetRefusal, tool: string) => ({ error, tool });

/** At most `limit` holders at once; the rest wait their turn in arrival order. */
class Semaphore {
  private free: number;
  private readonly waiting: (() => void)[] = [];
  constructor(limit: number) {
    this.free = Math.max(1, limit);
  }
  async acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    if (this.free > 0) {
      this.free -= 1;
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const onAbort = () => {
        const at = this.waiting.indexOf(grant);
        if (at >= 0) this.waiting.splice(at, 1);
        resolve(false);
      };
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      };
      this.waiting.push(grant);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

export function createBudget(options: Options): Budget {
  const maxRepeats = options.maxRepeats ?? DEFAULT_MAX_REPEATS;
  const slots = new Semaphore(options.concurrency);
  const stats: BudgetStats = {
    executed: 0,
    reused: 0,
    refused: {},
    resultBytes: 0,
    looping: false,
  };
  let first: BudgetRefusal | null = null;
  /** Calls by tool and canonical arguments: the settled result, and how often it was asked for. */
  const seen = new Map<string, { result: Promise<unknown>; asked: number }>();

  const refuse = (tool: string, reason: BudgetRefusal) => {
    stats.refused[reason] = (stats.refused[reason] ?? 0) + 1;
    first ??= reason;
    options.onRefusal?.(tool, reason);
    return failure(reason, tool);
  };

  /** Runs `run` for at most `timeoutMs`, ending early when `signal` aborts; never throws. */
  async function bounded(
    tool: string,
    run: (signal: AbortSignal) => unknown,
    callSignal: AbortSignal | undefined,
  ): Promise<unknown> {
    const signals = [AbortSignal.timeout(options.timeoutMs)];
    if (options.signal) signals.push(options.signal);
    if (callSignal) signals.push(callSignal);
    const timeout = signals[0] as AbortSignal;
    const signal = AbortSignal.any(signals);
    if (!(await slots.acquire(signal))) {
      return refuse(tool, timeout.aborted ? "tool_timeout" : "tool_aborted");
    }
    let onAbort = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("aborted"));
      // The signal may have fired while this call waited for its slot.
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    aborted.catch(() => {});
    try {
      return await Promise.race([Promise.resolve(run(signal)), aborted]);
    } catch {
      return refuse(
        tool,
        timeout.aborted ? "tool_timeout" : signal.aborted ? "tool_aborted" : "tool_failed",
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
      slots.release();
    }
  }

  function wrapOne(name: string, original: ToolSet[string]): ToolSet[string] {
    const execute = original.execute as
      | ((input: unknown, callOptions: { abortSignal?: AbortSignal }) => unknown)
      | undefined;
    if (typeof execute !== "function") return original;
    return {
      ...original,
      execute: async (input: unknown, callOptions: { abortSignal?: AbortSignal }) => {
        const key = `${name}\n${canonicalJson(input)}`;
        const earlier = seen.get(key);
        if (earlier) {
          earlier.asked += 1;
          if (earlier.asked > maxRepeats) {
            stats.looping = true;
            return refuse(name, "repeated_call");
          }
          stats.reused += 1;
          return earlier.result;
        }
        // Checked and counted in one synchronous step: the calls of one model step arrive together,
        // so a count that moved only after an await would let the whole burst through. Within a
        // burst the call limit is the bound; the result budget works between steps, as results
        // come back.
        if (stats.executed >= options.maxCalls) return refuse(name, "tool_limit_reached");
        if (stats.resultBytes >= options.maxResultBytes) {
          return refuse(name, "context_budget_exhausted");
        }
        stats.executed += 1;
        const result = bounded(
          name,
          (signal) => execute(input, { ...callOptions, abortSignal: signal }),
          callOptions?.abortSignal,
        ).then((value) => {
          stats.resultBytes += byteLength(value);
          return value;
        });
        seen.set(key, { result, asked: 1 });
        return result;
      },
    } as ToolSet[string];
  }

  return {
    wrap(tools) {
      return Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [name, wrapOne(name, tool)]),
      );
    },
    stats: () => ({ ...stats, refused: { ...stats.refused } }),
    firstRefusal: () => first,
  };
}

/** The limits whose breach ends an answer early, as a termination reason for the log. */
export function terminationOf(stats: BudgetStats): "loop" | "tool_limit" | "context_budget" | null {
  if (stats.looping) return "loop";
  if (stats.refused.tool_limit_reached) return "tool_limit";
  if (stats.refused.context_budget_exhausted) return "context_budget";
  return null;
}
