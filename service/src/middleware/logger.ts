/**
 * ─────────────────────────────────────────────────────────
 * Structured Logger (Winston)
 * ─────────────────────────────────────────────────────────
 */

import winston from "winston";

const LOG_LEVEL = process.env.LOG_LEVEL || "debug";

export function createLogger(module: string): winston.Logger {
  return winston.createLogger({
    level: LOG_LEVEL,
    defaultMeta: { module },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      process.env.NODE_ENV === "production"
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, module: mod, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? ` ${JSON.stringify(meta)}`
                : "";
              return `${timestamp} [${mod}] ${level}: ${message}${metaStr}`;
            })
          )
    ),
    transports: [new winston.transports.Console()],
  });
}
