import { z } from "zod";

// Server-only: never import from client components (holds upstream secrets).

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  DARKFANXING_BASE_URL: z.url().default("https://stocks.darkfanxing.com"),
  DARKFANXING_KEY: z.string().min(16),
  FINMIND_TOKEN: z.string().optional(),
  LLM_BASE_URL: z.url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  CRON_SECRET: z.string().min(32),
  INVITE_CODES: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
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
