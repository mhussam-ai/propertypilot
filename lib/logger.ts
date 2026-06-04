import pino from "pino";

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug");

export const logger = pino({
  level,
  base: {
    service: "propertypilot",
    env: process.env.NODE_ENV ?? "development",
  },
  redact: {
    paths: [
      "password",
      "api_key",
      "apiKey",
      "authorization",
      "*.password",
      "*.api_key",
      "*.apiKey",
      "*.bolna_api_key_ciphertext",
      "*.webhook_token_ciphertext",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

export function loggerWith(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings) as Logger;
}
