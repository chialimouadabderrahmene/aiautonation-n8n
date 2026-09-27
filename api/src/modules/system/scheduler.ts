import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { bootstrapN8n } from "../n8n/bootstrap";
import { reconcileWorkflows, markAllWorkflowsUnknown, ReconcileReport } from "../n8n/workflows";
import { syncN8nCredentials } from "../n8n/credentials";
import { pollN8nExecutions } from "../n8n/executions";
import { refreshExpiringTokens } from "../oauth/oauth";
import { ensureTelegramWebhook } from "../telegram/telegram";
import { recomputeAllReadiness } from "../workflows/readiness";
import { getN8nConnection, n8nProcessHealthy } from "../n8n/client";
import { getProvider } from "../providers/registry";
import { getProviderValues, recordTestResult } from "../integrations/vault";

/**
 * Background maintenance that makes the deployment self-configuring and
 * self-healing after every restart/redeploy — no human steps:
 *   - connect to n8n (owner + API key) as soon as it answers
 *   - import/reconcile the 22 workflows (idempotent, never activates)
 *   - mirror n8n executions into the Executions screen
 *   - refresh expiring OAuth tokens (and push X's into n8n)
 *   - keep the Telegram webhook registered
 *   - recompute readiness so the Dashboard reflects reality
 * Each task is guarded so it never overlaps itself and never crashes the API.
 */

const running = new Set<string>();
const lastRun: Record<string, { at: string; ok: boolean; message?: string }> = {};
let n8nReady = false;
let syncTimer: NodeJS.Timeout | null = null;

async function guard(name: string, fn: () => Promise<string | void>): Promise<void> {
  if (running.has(name)) return;
  running.add(name);
  try {
    const message = await fn();
    lastRun[name] = { at: new Date().toISOString(), ok: true, message: message || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastRun[name] = { at: new Date().toISOString(), ok: false, message };
    logger.warn({ task: name, err: message }, "[scheduler] task failed");
  } finally {
    running.delete(name);
  }
}

export function schedulerStatus() {
  return { n8nReady, lastRun };
}

async function saveReport(report: ReconcileReport) {
  await prisma.setting.upsert({
    where: { key: "_n8nLastReconcile" },
    update: { value: report as unknown as Prisma.InputJsonValue },
    create: { key: "_n8nLastReconcile", value: report as unknown as Prisma.InputJsonValue },
  });
}

export async function runN8nSync(actor = "system"): Promise<ReconcileReport> {
  const report = await reconcileWorkflows(actor);
  await saveReport(report);
  // Keep the n8n card's "last verified" message current (workflow count changes on import).
  const values = await getProviderValues("n8n").catch(() => null);
  if (values) await recordTestResult("n8n", await getProvider("n8n")!.testConnection(values));
  await recomputeAllReadiness();
  return report;
}

async function n8nTick(): Promise<string> {
  const outcome = await bootstrapN8n();
  if (outcome.status !== "connected" && outcome.status !== "already_connected") {
    n8nReady = false;
    return outcome.message;
  }
  const conn = await getN8nConnection();
  if (!(await n8nProcessHealthy(conn.baseUrl))) {
    n8nReady = false;
    await markAllWorkflowsUnknown();
    await recomputeAllReadiness();
    return "n8n not answering";
  }
  if (!n8nReady) {
    n8nReady = true;
    const report = await runN8nSync();
    return `n8n connected; ${report.present}/22 present (${report.imported.length} imported, ${report.updated.length} updated)`;
  }
  return "n8n connected";
}

/** Debounced full sync after an integration/setting change (credentials may
 * need to be created in n8n and workflow definitions re-pointed at them). */
export function requestN8nSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    if (!n8nReady) return;
    void guard("n8n-sync", async () => {
      const r = await runN8nSync();
      return `${r.present}/22 present, ${r.updated.length} updated`;
    });
  }, 2000);
}

export function startScheduler(): void {
  const every = (ms: number, name: string, fn: () => Promise<string | void>, initialDelay = 2000) => {
    setTimeout(() => {
      void guard(name, fn);
      setInterval(() => void guard(name, fn), ms).unref();
    }, initialDelay).unref();
  };

  every(15_000, "n8n-connect", n8nTick, 1000);
  every(5 * 60_000, "n8n-reconcile", async () => {
    if (!n8nReady) return "skipped: n8n not ready";
    const r = await runN8nSync();
    return `${r.present}/22 present, ${r.active} active${r.driftDeactivated.length ? `, ${r.driftDeactivated.length} drift-deactivated` : ""}`;
  }, 90_000);
  every(30_000, "n8n-executions", async () => {
    if (!n8nReady) return "skipped: n8n not ready";
    const { upserted } = await pollN8nExecutions();
    return `${upserted} execution(s) mirrored`;
  }, 15_000);
  every(5 * 60_000, "oauth-refresh", async () => {
    const refreshed = await refreshExpiringTokens();
    if (refreshed.includes("x") && n8nReady) await syncN8nCredentials();
    return refreshed.length ? `refreshed ${refreshed.join(", ")}` : "nothing to refresh";
  }, 20_000);
  every(10 * 60_000, "telegram-webhook", async () => (await ensureTelegramWebhook()).message, 25_000);
  every(60_000, "readiness", async () => {
    await recomputeAllReadiness();
  }, 5_000);
}
