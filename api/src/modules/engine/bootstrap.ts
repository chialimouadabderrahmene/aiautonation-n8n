import { logger } from "../../lib/logger";
import { outboxRelayTick } from "./outbox";
import { cronSchedulerTick, recoverStalledExecutions } from "./scheduler";
import { startEngineWorkers, stopEngineWorkers } from "./queue";
import { matchTrigger } from "./matcher";
import { runExecution, reconcileAfterRun } from "./executor";

/**
 * Starts the native workflow engine's background machinery in-process, alongside the existing
 * n8n-management scheduler (modules/system/scheduler.ts) — the two are independent; this one
 * owns nothing n8n-related. Mirrors that module's guard()/every() pattern so a slow tick can
 * never overlap itself and a thrown error can never crash the API process.
 */

const running = new Set<string>();
const lastRun: Record<string, { at: string; ok: boolean; message?: string }> = {};

async function guard(name: string, fn: () => Promise<string | void>): Promise<void> {
  if (running.has(name)) return;
  running.add(name);
  try {
    const message = await fn();
    lastRun[name] = { at: new Date().toISOString(), ok: true, message: message || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastRun[name] = { at: new Date().toISOString(), ok: false, message };
    logger.warn({ task: name, err: message }, "[engine] background task failed");
  } finally {
    running.delete(name);
  }
}

export function engineSchedulerStatus() {
  return { lastRun };
}

export function startWorkflowEngine(): void {
  startEngineWorkers(
    async (job) => {
      const { created, deduped } = await matchTrigger(job.data);
      logger.info({ eventType: job.data.eventType, created, deduped }, "[engine] trigger matched");
    },
    async (job) => {
      await runExecution(job.data.executionId);
    },
    reconcileAfterRun,
  );

  const every = (ms: number, name: string, fn: () => Promise<string | void>, initialDelay = 2000) => {
    setTimeout(() => {
      void guard(name, fn);
      setInterval(() => void guard(name, fn), ms).unref();
    }, initialDelay).unref();
  };

  every(10_000, "engine-outbox-relay", async () => {
    const r = await outboxRelayTick();
    return r.published || r.failed ? `${r.published} published, ${r.failed} failed` : undefined;
  }, 3_000);
  every(30_000, "engine-cron-scheduler", async () => {
    const r = await cronSchedulerTick();
    return r.fired ? `${r.fired}/${r.rescheduled} fired` : undefined;
  }, 5_000);
  every(60_000, "engine-stalled-sweep", async () => {
    const r = await recoverStalledExecutions();
    return r.recovered ? `${r.recovered} recovered` : undefined;
  }, 20_000);

  logger.info("[engine] native workflow engine started");
}

export async function stopWorkflowEngine(): Promise<void> {
  await stopEngineWorkers();
}
