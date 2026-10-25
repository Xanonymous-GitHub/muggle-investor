// Collects what a run knows about itself and the stream does not carry: why it ended, whether the
// answer came from the fallback, tokens and time. It listens on the logger the service already
// writes content-free lines to, so the service needs no eval hook. Pure apart from the callbacks it
// forwards to `base`.
import type { Logger } from "pino";
import type { Egress, RunFacts } from "./checks";
import type { EvalAnswer } from "./transcript";

type Fields = Record<string, unknown>;
type LogFn = (fields: Fields, message?: string) => void;

export type RunRecorder = {
  /** Hand this to the service as its logger. */
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  /** The facts of the run so far; `egressEscaped` is null where nothing watches the service. */
  facts(answer: EvalAnswer, latencyMs: number, egressEscaped: number | null): RunFacts;
};

const FALLBACK_LINE = "cannot continue after a tool call";

export function createRunRecorder(
  base?: Partial<Pick<Logger, "debug" | "info" | "warn" | "error">>,
): RunRecorder {
  let answered: Fields | undefined;
  let fallback = false;
  const forward = (level: "debug" | "info" | "warn" | "error"): LogFn => {
    return (fields, message) => {
      if (level === "info" && message === "ask answered") answered = fields;
      if (level === "warn" && message?.includes(FALLBACK_LINE)) fallback = true;
      base?.[level]?.(fields, message);
    };
  };
  const logger = {
    debug: forward("debug"),
    info: forward("info"),
    warn: forward("warn"),
    error: forward("error"),
  } as unknown as RunRecorder["logger"];

  return {
    logger,
    facts(answer, latencyMs, egressEscaped) {
      const number = (key: string): number | null => {
        const value = answered?.[key];
        return typeof value === "number" ? value : null;
      };
      const egress: Egress = {
        attempted: answer.tools.filter((name) => name.includes("__")).length,
        blocked: answer.blockedToolCalls,
        escaped: egressEscaped,
      };
      return {
        termination: typeof answered?.termination === "string" ? answered.termination : null,
        fallback,
        latencyMs,
        inputTokens: number("inputTokens"),
        outputTokens: number("outputTokens"),
        egress,
      };
    },
  };
}
