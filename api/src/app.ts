import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import IORedis from "ioredis";
import { prisma } from "./lib/prisma";
import { n8nClient } from "./modules/workflows/n8nClient";
import { authRouter } from "./routes/auth";
import { integrationsRouter } from "./routes/integrations";
import { workflowsRouter } from "./routes/workflows";
import { videoRouter } from "./routes/video";
import { approvalsRouter, approvalsPublicRouter } from "./routes/approvals";
import { executionsRouter } from "./routes/executions";
import { reportsRouter } from "./routes/reports";
import { settingsRouter } from "./routes/settings";
import { auditRouter } from "./routes/audit";
import { dashboardRouter } from "./routes/dashboard";
import { requireAdmin } from "./modules/auth/auth";

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.WEB_ORIGIN?.split(",") ?? true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(
    pinoHttp({
      // Never log Authorization headers or bodies (credential save/test
      // payloads could otherwise land in log output).
      redact: ["req.headers.authorization", "req.body.secrets", "req.body.password"],
    }),
  );

  // Liveness only — the process is up and answering HTTP. Deliberately does
  // NOT touch the database/Redis, so a container platform never restarts a
  // perfectly healthy API process just because Postgres had a blip (that's
  // what /health/detailed and the Dashboard's own status cards are for).
  app.get("/health", (_req, res) => res.json({ ok: true, service: "eki-automation-api" }));

  // Readiness/dependency check — real checks, not a static "ok". Mirrors the
  // Eki backend's own GET /api/health/detailed convention (see
  // FINAL_TECHNICAL_HANDOVER.md), applied here to this project's own,
  // separate dependencies. Never reports ONLINE for something unreachable.
  app.get("/health/detailed", async (_req, res) => {
    const database = await prisma
      .$queryRaw`SELECT 1`
      .then(() => ({ status: "ONLINE" as const }))
      .catch((err: unknown) => ({ status: "OFFLINE" as const, error: err instanceof Error ? err.message : String(err) }));

    const redisUrl = process.env.REDIS_URL;
    const redis = !redisUrl
      ? { status: "NOT_CONFIGURED" as const }
      : await (async () => {
          const client = new IORedis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true });
          try {
            await client.connect();
            await client.ping();
            return { status: "ONLINE" as const };
          } catch (err) {
            return { status: "OFFLINE" as const, error: err instanceof Error ? err.message : String(err) };
          } finally {
            client.disconnect();
          }
        })();

    const n8nIntegration = await prisma.integration.findUnique({ where: { provider: "n8n" } });
    const n8n =
      !n8nIntegration || n8nIntegration.status === "NOT_CONFIGURED"
        ? { status: "NOT_CONFIGURED" as const }
        : { status: (await n8nClient.isReachable()) ? ("ONLINE" as const) : ("OFFLINE" as const) };

    const overallOk = database.status === "ONLINE" && redis.status !== "OFFLINE";
    res.status(overallOk ? 200 : 503).json({ ok: overallOk, service: "eki-automation-api", database, redis, n8n });
  });

  // Telegram calls this directly — a separate router (never the admin one),
  // gated by its own shared-secret check inside the route.
  app.use("/api/approvals", approvalsPublicRouter);

  app.use("/api/auth", authRouter);
  app.use("/api/integrations", requireAdmin, integrationsRouter);
  app.use("/api/workflows", requireAdmin, workflowsRouter);
  app.use("/api/video", requireAdmin, videoRouter);
  app.use("/api/approvals", requireAdmin, approvalsRouter);
  app.use("/api/executions", requireAdmin, executionsRouter);
  app.use("/api/reports", requireAdmin, reportsRouter);
  app.use("/api/settings", requireAdmin, settingsRouter);
  app.use("/api/audit", requireAdmin, auditRouter);
  app.use("/api/dashboard", requireAdmin, dashboardRouter);

  app.use((_req, res) => res.status(404).json({ message: "Not found" }));

  return app;
}
