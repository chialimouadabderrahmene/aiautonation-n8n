import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import { createApp } from "./app";
import { bootstrap } from "./bootstrap";
import { logger } from "./lib/logger";

/**
 * Vercel entrypoint (services: api). Each function instance runs the shared bootstrap once,
 * before its first request. A failed bootstrap is retried on the next request.
 * Not started here: the background scheduler and the internal listener (long-running only).
 */

let ready: Promise<void> | null = null;

function ensureBootstrapped(): Promise<void> {
  ready ??= bootstrap().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

const app = express();
app.use(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await ensureBootstrapped();
    next();
  } catch (err) {
    logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "[eki-automation-api] bootstrap failed");
    res.status(503).json({ message: "Service is starting or misconfigured. Try again shortly." });
  }
});
app.use(createApp());

export default app;
