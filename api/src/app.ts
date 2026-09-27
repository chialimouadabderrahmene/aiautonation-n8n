import "express-async-errors";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import crypto from "node:crypto";
import { logger } from "./lib/logger";
import { scrubSecrets } from "./lib/http";
import { authRouter } from "./routes/auth";
import { integrationsRouter, oauthPublicRouter } from "./routes/integrations";
import { workflowsRouter } from "./routes/workflows";
import { videoRouter } from "./routes/video";
import { approvalsRouter, telegramPublicRouter } from "./routes/approvals";
import { executionsRouter } from "./routes/executions";
import { reportsRouter } from "./routes/reports";
import { settingsRouter } from "./routes/settings";
import { auditRouter } from "./routes/audit";
import { dashboardRouter } from "./routes/dashboard";
import { mediaRouter, mediaPublicRouter } from "./routes/media";
import { internalRouter } from "./routes/internal";
import { requireAdmin } from "./modules/auth/auth";
import { systemHealth, checkDatabase } from "./modules/system/health";
import { recordAudit } from "./modules/audit/audit";

function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as Request & { id?: string }).id ?? crypto.randomUUID();
  const message = scrubSecrets(err instanceof Error ? err.message : String(err), []);
  logger.error({ requestId, path: req.path, err: message }, "unhandled error");
  void recordAudit("system", "error.unhandled", "Request", req.path.slice(0, 120), { requestId, message: message.slice(0, 300) }).catch(() => undefined);
  if (!res.headersSent) res.status(500).json({ message: "Something went wrong on the server. It has been logged.", requestId });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind Railway's edge + the web proxy: trust the first hop for req.ip (rate limits).
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } }));
  const origins = process.env.WEB_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins && origins.length ? origins : false, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers["x-request-id"] as string) ?? crypto.randomUUID(),
      autoLogging: { ignore: (req) => req.url === "/health" },
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split("?")[0] }) },
    }),
  );

  // Liveness only — never touches dependencies, so a DB blip never gets the API restarted.
  app.get("/health", (_req, res) => res.json({ ok: true, service: "eki-automation-api" }));
  // Readiness for the platform: 200 only when the database answers.
  app.get("/health/ready", async (_req, res) => {
    const db = await checkDatabase();
    res.status(db.status === "ONLINE" ? 200 : 503).json({ ok: db.status === "ONLINE" });
  });

  // Public routes (each with its own verification).
  app.use("/api/telegram", telegramPublicRouter); // secret_token header
  app.use("/api/oauth", oauthPublicRouter); // single-use state
  app.use("/api/media", mediaPublicRouter); // HMAC-signed, expiring links

  app.use("/api/auth", authRouter);
  app.use("/api/system/health", requireAdmin, async (_req, res) => res.json(await systemHealth()));
  app.use("/api/integrations", requireAdmin, integrationsRouter);
  app.use("/api/workflows", requireAdmin, workflowsRouter);
  app.use("/api/video", requireAdmin, videoRouter);
  app.use("/api/approvals", requireAdmin, approvalsRouter);
  app.use("/api/executions", requireAdmin, executionsRouter);
  app.use("/api/reports", requireAdmin, reportsRouter);
  app.use("/api/settings", requireAdmin, settingsRouter);
  app.use("/api/audit", requireAdmin, auditRouter);
  app.use("/api/dashboard", requireAdmin, dashboardRouter);
  app.use("/api/media", requireAdmin, mediaRouter);

  app.use((_req, res) => res.status(404).json({ message: "Not found" }));
  app.use(errorHandler);
  return app;
}

/** Internal listener: service-to-service only (n8n supervisor). */
export function createInternalApp() {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/internal", internalRouter);
  app.use((_req, res) => res.status(404).json({ message: "Not found" }));
  app.use(errorHandler);
  return app;
}
