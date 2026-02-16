/**
 * ─────────────────────────────────────────────────────────
 * Global Error Handler Middleware
 * ─────────────────────────────────────────────────────────
 */

import { Request, Response, NextFunction } from "express";
import { v4 as uuid } from "uuid";
import { createLogger } from "./logger";

const logger = createLogger("error-handler");

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = uuid();

  if (err instanceof AppError) {
    logger.error(`[${requestId}] ${err.code}: ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
      },
    });
    return;
  }

  // Unexpected errors
  logger.error(`[${requestId}] Unhandled error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
    meta: {
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
  });
}
