import "dotenv/config";
import { Server } from "node:http";
import { createApp, createInternalApp } from "./app";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import { bootstrap } from "./bootstrap";
import { startScheduler } from "./modules/system/scheduler";

/**
 * Long-running server (Docker / Railway). Runs the shared bootstrap, then listens
 * (public + internal) and starts background maintenance. Vercel uses src/vercel.ts instead.
 */

async function main() {
  await bootstrap();

  const port = Number(process.env.PORT ?? 4100);
  const internalPort = Number(process.env.INTERNAL_PORT ?? 4110);
  const servers: Server[] = [];
  servers.push(createApp().listen(port, () => logger.info(`[eki-automation-api] listening on :${port}`)));
  if (process.env.INTERNAL_API_TOKEN) {
    servers.push(createInternalApp().listen(internalPort, () => logger.info(`[eki-automation-api] internal listener on :${internalPort}`)));
  } else {
    logger.info("[startup] internal listener disabled; no external orchestrator is required");
  }
  startScheduler();

  const shutdown = (signal: string) => {
    logger.info(`[eki-automation-api] ${signal} received, shutting down`);
    for (const s of servers) s.close();
    setTimeout(() => process.exit(0), 5000).unref();
    void prisma.$disconnect().finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, "unhandled rejection"));

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "[eki-automation-api] fatal startup error");
  process.exit(1);
});
