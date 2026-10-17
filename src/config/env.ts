import { z } from "zod";

// Server-only: never import from client components (holds upstream secrets).

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** The app's own secrets: an MCP server's headers may never carry them. */
const APP_SECRETS = new Set([
  "AUTH_SECRET",
  "CRON_SECRET",
  "LLM_API_KEY",
  "DATABASE_URL",
  "DARKFANXING_KEY",
  "FINMIND_TOKEN",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https only; plain http only to this machine (a local MCP server during development). */
function isAllowedMcpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** One MCP server the Ask feature may call; only tools named in `allow` are reachable. */
export const mcpServerSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  url: z.url().refine(isAllowedMcpUrl, {
    message: "must be https (http only for localhost, 127.0.0.1 or [::1])",
  }),
  transport: z.enum(["http", "sse"]).default("http"),
  /** Request header name -> name of the env var that holds its value (values never live in this JSON). */
  headerEnv: z
    .record(
      z.string().min(1),
      z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
        .refine((name) => !APP_SECRETS.has(name), {
          message: "must not name one of the app's own secrets",
        }),
    )
    .default({}),
  allow: z.array(z.string().min(1)).min(1),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;

/** A JSON array in an env var; a parse failure is reported on the variable's own key, never its value. */
const mcpServersSchema = z
  .string()
  .optional()
  .transform((raw, ctx): unknown => {
    if (raw === undefined || raw.trim() === "") return [];
    try {
      return JSON.parse(raw);
    } catch {
      ctx.issues.push({ code: "custom", message: "not valid JSON", input: raw });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(mcpServerSchema)
      // Tools are exposed as `${name}__${tool}`: names must not collide or contain the separator.
      .refine((servers) => new Set(servers.map((s) => s.name)).size === servers.length, {
        message: "server names must be unique",
      })
      .refine((servers) => servers.every((s) => !s.name.includes("__")), {
        message: 'server names must not contain "__"',
      }),
  );

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  DARKFANXING_BASE_URL: z.url().default("https://stocks.darkfanxing.com"),
  DARKFANXING_KEY: z.string().min(16),
  FINMIND_TOKEN: z.string().optional(),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_STRUCTURED_OUTPUT: z.enum(["native", "prompt"]).default("native"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000),
  CRON_SECRET: z.string().min(32),
  /** Signs the invite-code session cookie. */
  AUTH_SECRET: z.string().min(32),
  INVITE_CODES: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
  ASK_VOICE: z.enum(["analyst", "facts_only"]).default("analyst"),
  ASK_TOOLS: z.enum(["on", "off"]).default("on"),
  ASK_MCP_SERVERS: mcpServersSchema,
  ASK_DAILY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(30),
  ASK_MAX_STEPS: z.coerce.number().int().positive().default(6),
  ASK_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  ASK_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2500),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly keys: string[];

  constructor(keys: string[]) {
    super(`Invalid environment variables: ${keys.join(", ")}`);
    this.name = "EnvError";
    this.keys = keys;
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "(root)")))];
  throw new EnvError(keys);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
