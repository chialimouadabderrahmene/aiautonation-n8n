import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
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

  app.get("/health", (_req, res) => res.json({ ok: true, service: "eki-automation-api" }));

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
