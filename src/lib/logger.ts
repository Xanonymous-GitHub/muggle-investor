import pino from "pino";
import { LOG_LEVELS, type LogLevel } from "@/config/env";

const isLogLevel = (value: string): value is LogLevel =>
  (LOG_LEVELS as readonly string[]).includes(value);

/**
 * LOG_LEVEL as a pino level; empty or unknown values fall back to "info". The logger is built
 * at import time, before (and independently of) env validation, and pino throws on an
 * unknown level.
 */
export function resolveLogLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim() || "info";
  return isLogLevel(value) ? value : "info";
}

export const logger = pino({
  level: resolveLogLevel(process.env.LOG_LEVEL),
  redact: ["*.key", "*.apiKey", "*.token", "headers.authorization", "url"],
});
