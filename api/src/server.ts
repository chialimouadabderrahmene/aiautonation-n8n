import "dotenv/config";
import { Server } from "node:http";
import { createApp, createInternalApp } from "./app";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import { bootstrapAdmin } from "./modules/auth/auth";
import { ensureIntegrationRows, autoVerifyGeneratedIntegrations } from "./modules/integrations/vault";
import { recomputeAllReadiness } from "./modules/workflows/readiness";
import { startScheduler } from "./modules/system/scheduler";
import { getTelegramWebhookSecret } from "./modules/telegram/telegram";

/**
 * Start-up sequence (runs on every boot/redeploy, all steps idempotent):
 *   1. refuse to start without the required secrets (fail loudly, not later)
 *   2. wait for the database (it may still be starting after a platform restart)
 *   3. verify every table the app needs exists (migrations ran — see docker/api-entrypoint.sh)
 *   4. bootstrap the admin account, integration rows, generated secrets, readiness
 *   5. listen (public + internal), then start background maintenance
 */

const REQUIRED_ENV = ["DATABASE_URL", "AUTOMATION_SECRET_KEY", "JWT_SECRET"];
const REQUIRED_TABLES = [
  "AdminUser", "Integration", "EncryptedCredential", "WorkflowConfig", "AutomationExecution", "VideoProject", "VideoJob",
  "VideoScene", "VideoAsset", "Approval", "Publication", "MediaFile", "OAuthState", "ServiceHeartbeat", "Setting", "AuditLog",
];

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn({ attempt }, "[startup] database not reachable yet, retrying in 2s");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function verifyTables(): Promise<void> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`;
  const present = new Set(rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length) throw new Error(`Database is missing tables ${missing.join(", ")} — migrations did not run (prisma migrate deploy)`);
}

async function main() {
  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missingEnv.length) throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  if ((process.env.AUTOMATION_SECRET_KEY ?? "").length < 32) throw new Error("AUTOMATION_SECRET_KEY must be at least 32 characters");
  if ((process.env.JWT_SECRET ?? "").length < 32) throw new Error("JWT_SECRET must be at least 32 characters");
  if (process.env.INTERNAL_API_TOKEN && process.env.INTERNAL_API_TOKEN.length < 24) throw new Error("INTERNAL_API_TOKEN must be at least 24 characters");

  await waitForDatabase();
  await verifyTables();
  await bootstrapAdmin();
  await ensureIntegrationRows();
  await getTelegramWebhookSecret();
  await autoVerifyGeneratedIntegrations();
  await recomputeAllReadiness();

  const port = Number(process.env.PORT ?? 4100);
  const internalPort = Number(process.env.INTERNAL_PORT ?? 4110);
  const servers: Server[] = [];
  servers.push(createApp().listen(port, () => logger.info(`[eki-automation-api] listening on :${port}`)));
  if (process.env.INTERNAL_API_TOKEN) {
    servers.push(createInternalApp().listen(internalPort, () => logger.info(`[eki-automation-api] internal listener on :${internalPort}`)));
  } else {
    logger.warn("[startup] INTERNAL_API_TOKEN not set — n8n supervisor endpoints disabled");
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
