import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  type OutputInterface,
  RetryError,
} from "ai";
import type { Logger } from "pino";
import { z } from "zod";
import type { Env } from "@/config/env";
import { logger as defaultLogger } from "@/lib/logger";
import { extractJsonObject, LlmOutputError, type LlmUsage } from "./json-extract";
import { chainResponsesFetch } from "./responses-chain";

// Server-only: the model built from env holds LLM_API_KEY. Errors leaving this module are always
// `LlmOutputError` with a short reason, so provider errors (URL, request body, headers) never
// travel further.

export { LlmOutputError, type LlmUsage };
export type StructuredOutputMode = "native" | "prompt";

export type GenerateObjectRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Extra calls allowed in prompt mode after the model's output fails to parse. Default 2. */
  maxRepairs?: number;
};

export interface Llm {
  readonly modelId: string;
  generateObject<T>(req: GenerateObjectRequest<T>): Promise<{ object: T; usage: LlmUsage }>;
}

export type CreateLlmOptions = {
  model: LanguageModel;
  modelId: string;
  /** `native` asks the endpoint for JSON-schema output; `prompt` puts the schema in the prompt. */
  mode: StructuredOutputMode;
  timeoutMs: number;
  maxOutputTokens: number;
  /** Receives a warning (HTTP status only) when the instance switches native → prompt mode. */
  logger?: Pick<Logger, "warn">;
};

const JSON_ONLY = "只輸出一個 JSON 物件，不要其他文字";
const DEFAULT_MAX_REPAIRS = 2;
const EXCERPT_CHARS = 200;
const ISSUES_CHARS = 500;

const NO_USAGE: LlmUsage = { inputTokens: null, outputTokens: null };

export function createLlm(opts: CreateLlmOptions): Llm {
  const log = opts.logger ?? defaultLogger;
  // Shared by every call on this instance: once the endpoint rejects JSON-schema output we stop
  // asking for it for the rest of the process.
  let mode = opts.mode;

  /** Usage of every HTTP call one `generateObject` makes, so a failure can still report it. */
  type Tally = { usage: LlmUsage };
  const count = (tally: Tally, usage: LlmUsage) => {
    tally.usage = addUsage(tally.usage, usage);
  };

  async function call<OUTPUT extends OutputInterface>(
    system: string,
    prompt: string,
    output: OUTPUT,
  ) {
    const abortSignal = AbortSignal.timeout(opts.timeoutMs);
    try {
      return await generateText({
        model: opts.model,
        system,
        prompt,
        abortSignal,
        maxOutputTokens: opts.maxOutputTokens,
        output,
      });
    } catch (error) {
      if (abortSignal.aborted) throw new LlmOutputError("LLM request timed out or was aborted");
      throw error;
    }
  }

  async function generateNative<T>(req: GenerateObjectRequest<T>, tally: Tally) {
    try {
      const result = await call(req.system, req.prompt, Output.object({ schema: req.schema }));
      count(tally, toUsage(result.usage));
      return { object: result.output, usage: toUsage(result.usage) };
    } catch (error) {
      // A reply that does not match the schema throws NoObjectGeneratedError, with its usage.
      if (NoObjectGeneratedError.isInstance(error) && error.usage) {
        count(tally, toUsage(error.usage));
      }
      throw error;
    }
  }

  async function generateWithPrompt<T>(req: GenerateObjectRequest<T>, tally: Tally) {
    const maxRepairs = req.maxRepairs ?? DEFAULT_MAX_REPAIRS;
    const schemaJson = JSON.stringify(z.toJSONSchema(req.schema, { io: "input" }));
    const system = `${req.system}\n\n${JSON_ONLY}。這個 JSON 物件必須符合以下 JSON Schema：\n${schemaJson}`;
    let prompt = req.prompt;
    let usage: LlmUsage = NO_USAGE;
    for (let attempt = 0; ; attempt++) {
      const result = await call(system, prompt, Output.text());
      usage = addUsage(usage, toUsage(result.usage));
      count(tally, toUsage(result.usage));
      const parsed = parseReply(result.output, req.schema);
      if (parsed.ok) return { object: parsed.value, usage };
      if (attempt >= maxRepairs) {
        throw new LlmOutputError(
          `model output failed validation after ${attempt + 1} attempt(s): ${bound(parsed.issues, ISSUES_CHARS)}; output excerpt: ${JSON.stringify(bound(result.output, EXCERPT_CHARS))}`,
        );
      }
      prompt = `${req.prompt}\n\n你上一次的輸出不符合要求：\n${parsed.issues}\n請修正後重新輸出完整的 JSON 物件，${JSON_ONLY}。`;
    }
  }

  return {
    modelId: opts.modelId,
    async generateObject<T>(req: GenerateObjectRequest<T>) {
      const tally: Tally = { usage: NO_USAGE };
      try {
        if (mode === "native") {
          try {
            return await generateNative(req, tally);
          } catch (error) {
            if (rejectsStructuredOutput(error)) {
              log.warn(
                { statusCode: error.statusCode },
                "LLM endpoint rejected structured output; switching to prompt mode",
              );
              mode = "prompt";
            } else if (!NoObjectGeneratedError.isInstance(error)) {
              throw error;
            }
            // An unparsable or schema-invalid native reply: retry this request only through the
            // prompt path (with its repairs); the instance stays in native mode.
            const result = await generateWithPrompt(req, tally);
            return { object: result.object, usage: tally.usage };
          }
        }
        return await generateWithPrompt(req, tally);
      } catch (error) {
        throw toLlmOutputError(error, tally.usage);
      }
    },
  };
}

/**
 * The configured model (holds LLM_API_KEY): the Responses API by default, the chat completions API
 * when LLM_API is "chat".
 */
export function createModelFromEnv(
  env: Pick<Env, "LLM_BASE_URL" | "LLM_API_KEY" | "LLM_MODEL" | "LLM_API">,
): LanguageModel {
  if (env.LLM_API === "chat") {
    const provider = createOpenAICompatible({
      name: "llm",
      baseURL: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      // Without this the provider downgrades a schema request to plain `json_object`, so "native"
      // mode would never send the schema. Endpoints that reject it trigger the prompt fallback.
      supportsStructuredOutputs: true,
    });
    return provider.chatModel(env.LLM_MODEL);
  }
  const provider = createOpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    fetch: chainResponsesFetch(),
  });
  return provider.responses(env.LLM_MODEL);
}

export function createLlmFromEnv(
  env: Pick<
    Env,
    | "LLM_BASE_URL"
    | "LLM_API_KEY"
    | "LLM_MODEL"
    | "LLM_API"
    | "LLM_STRUCTURED_OUTPUT"
    | "LLM_TIMEOUT_MS"
    | "LLM_MAX_OUTPUT_TOKENS"
  >,
): Llm {
  return createLlm({
    model: createModelFromEnv(env),
    modelId: env.LLM_MODEL,
    mode: env.LLM_STRUCTURED_OUTPUT,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  });
}

/** An endpoint that does not support `response_format: json_schema` answers 400 or 422. */
function rejectsStructuredOutput(error: unknown): error is APICallError {
  return APICallError.isInstance(error) && (error.statusCode === 400 || error.statusCode === 422);
}

type ParsedReply<T> = { ok: true; value: T } | { ok: false; issues: string };

function parseReply<T>(text: string, schema: z.ZodType<T>): ParsedReply<T> {
  let json: unknown;
  try {
    json = extractJsonObject(text);
  } catch (error) {
    if (error instanceof LlmOutputError) return { ok: false, issues: error.message };
    throw error;
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.map(
    (issue) => `- ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
  );
  return { ok: false, issues: issues.join("\n") };
}

/** `error` as an `LlmOutputError` carrying `usage`, the tokens of every call made so far. */
function toLlmOutputError(error: unknown, usage: LlmUsage): LlmOutputError {
  if (error instanceof LlmOutputError) return new LlmOutputError(error.message, usage);
  if (RetryError.isInstance(error)) {
    return new LlmOutputError(
      `LLM request failed after retries: ${describe(error.lastError)}`,
      usage,
    );
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    return new LlmOutputError(
      `model output did not match the schema; output excerpt: ${JSON.stringify(bound(error.text ?? "", EXCERPT_CHARS))}`,
      usage,
    );
  }
  return new LlmOutputError(`LLM request failed: ${describe(error)}`, usage);
}

/** Error class and HTTP status only: provider messages can echo URLs, bodies or headers. */
function describe(error: unknown): string {
  if (APICallError.isInstance(error)) return `HTTP ${error.statusCode ?? "error without status"}`;
  return error instanceof Error ? error.name : "unknown error";
}

function toUsage(usage: LanguageModelUsage): LlmUsage {
  return { inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null };
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  const add = (x: number | null, y: number | null) =>
    x === null && y === null ? null : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
  };
}

function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
