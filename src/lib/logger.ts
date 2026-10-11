import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["*.key", "*.apiKey", "*.token", "headers.authorization", "url"],
});
