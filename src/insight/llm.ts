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
import { z } from "zod";
import type { Env } from "@/config/env";
import { extractJsonObject, LlmOutputError } from "./json-extract";

// Server-only: the model built from env holds LLM_API_KEY. Errors leaving this module are always
// `LlmOutputError` with a short reason, so provider errors (URL, request body, headers) never
// travel further.

export { LlmOutputError };

export type LlmUsage = { inputTokens: number | null; outputTokens: number | null };
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
};

const JSON_ONLY = "只輸出一個 JSON 物件，不要其他文字";
const DEFAULT_MAX_REPAIRS = 2;
const EXCERPT_CHARS = 200;
const ISSUES_CHARS = 500;

export function createLlm(opts: CreateLlmOptions): Llm {
  // Shared by every call on this instance: once the endpoint rejects JSON-schema output we stop
  // asking for it for the rest of the process.
  let mode = opts.mode;

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

  async function generateNative<T>(req: GenerateObjectRequest<T>) {
    const result = await call(req.system, req.prompt, Output.object({ schema: req.schema }));
    // A reply that does not match the schema throws NoObjectGeneratedError.
    return { object: result.output, usage: toUsage(result.usage) };
  }

  async function generateWithPrompt<T>(req: GenerateObjectRequest<T>) {
    const maxRepairs = req.maxRepairs ?? DEFAULT_MAX_REPAIRS;
    const schemaJson = JSON.stringify(z.toJSONSchema(req.schema, { io: "input" }));
    const system = `${req.system}\n\n${JSON_ONLY}。這個 JSON 物件必須符合以下 JSON Schema：\n${schemaJson}`;
    let prompt = req.prompt;
    let usage: LlmUsage = { inputTokens: null, outputTokens: null };
    for (let attempt = 0; ; attempt++) {
      const result = await call(system, prompt, Output.text());
      usage = addUsage(usage, toUsage(result.usage));
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
      try {
        if (mode === "native") {
          try {
            return await generateNative(req);
          } catch (error) {
            if (!rejectsStructuredOutput(error)) throw error;
            mode = "prompt";
          }
        }
        return await generateWithPrompt(req);
      } catch (error) {
        throw toLlmOutputError(error);
      }
    },
  };
}

export function createLlmFromEnv(
  env: Pick<
    Env,
    | "LLM_BASE_URL"
    | "LLM_API_KEY"
    | "LLM_MODEL"
    | "LLM_STRUCTURED_OUTPUT"
    | "LLM_TIMEOUT_MS"
    | "LLM_MAX_OUTPUT_TOKENS"
  >,
): Llm {
  const provider = createOpenAICompatible({
    name: "llm",
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    // Without this the provider downgrades a schema request to plain `json_object`, so "native"
    // mode would never send the schema. Endpoints that reject it trigger the prompt fallback.
    supportsStructuredOutputs: true,
  });
  return createLlm({
    model: provider.chatModel(env.LLM_MODEL),
    modelId: env.LLM_MODEL,
    mode: env.LLM_STRUCTURED_OUTPUT,
    timeoutMs: env.LLM_TIMEOUT_MS,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  });
}

/** An endpoint that does not support `response_format: json_schema` answers 400 or 422. */
function rejectsStructuredOutput(error: unknown): boolean {
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

function toLlmOutputError(error: unknown): LlmOutputError {
  if (error instanceof LlmOutputError) return error;
  if (RetryError.isInstance(error)) {
    return new LlmOutputError(`LLM request failed after retries: ${describe(error.lastError)}`);
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    return new LlmOutputError(
      `model output did not match the schema; output excerpt: ${JSON.stringify(bound(error.text ?? "", EXCERPT_CHARS))}`,
    );
  }
  return new LlmOutputError(`LLM request failed: ${describe(error)}`);
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
