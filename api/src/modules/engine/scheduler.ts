import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { nextRunAt } from "./cron";
import { enqueueExecutionRun, getExecutionRunQueue } from "./queue";
import { EngineExecutionStatus } from "@prisma/client";

const INSTANCE_ID = crypto.randomUUID();
const LOCK_STALE_MS = 2 * 60_000;

/**
 * Fires every ScheduledTrigger whose nextRunAt has passed. Each row is locked (lockedAt/lockedBy)
 * before firing so two API instances can never double-fire the same tick; a lock older than
 * LOCK_STALE_MS is assumed to belong to a crashed instance and is reclaimed — this IS the
 * "missed run" policy: a tick that was due during downtime fires once, immediately, on the next
 * tick after recovery (never fires the SAME due tick twice, never silently skips it).
 */
export async function cronSchedulerTick(): Promise<{ fired: number; rescheduled: number }> {
  const now = new Date();
  const due = await prisma.engineScheduledTrigger.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_STALE_MS) } }],
    },
    include: { workflow: true },
    take: 50,
  });

  let fired = 0;
  for (const trigger of due) {
    const claim = await prisma.engineScheduledTrigger.updateMany({
      where: { id: trigger.id, OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(now.getTime() - LOCK_STALE_MS) } }] },
      data: { lockedAt: now, lockedBy: INSTANCE_ID },
    });
    if (claim.count === 0) continue; // another instance (or tick) claimed it first

    const firedAt = trigger.nextRunAt; // the scheduled instant, not wall-clock now — keeps idempotency keys stable under retry
    try {
      if (trigger.workflow.enabled) {
        const { matchTrigger } = await import("./matcher");
        await matchTrigger({ eventType: "cron.tick", payload: { firedAt: firedAt.toISOString() }, source: "cron", workflowKey: trigger.workflow.key });
        fired++;
      } else {
        logger.info({ workflowKey: trigger.workflow.key }, "[engine] cron fired but workflow is disabled — skipped");
      }
      const next = nextRunAt(trigger.cron, trigger.timezone, firedAt);
      await prisma.engineScheduledTrigger.update({ where: { id: trigger.id }, data: { nextRunAt: next, lastRunAt: now, lastRunOk: true, lockedAt: null, lockedBy: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ workflowKey: trigger.workflow.key, err: message }, "[engine] cron tick failed");
      // Advance past the failed tick anyway using an invalid-cron-safe fallback (retry next cycle),
      // so one bad tick can never jam the schedule forever; the failure itself is recorded for the
      // operator via lastRunOk=false.
      try {
        const next = nextRunAt(trigger.cron, trigger.timezone, firedAt);
        await prisma.engineScheduledTrigger.update({ where: { id: trigger.id }, data: { nextRunAt: next, lastRunAt: now, lastRunOk: false, lockedAt: null, lockedBy: null } });
      } catch {
        await prisma.engineScheduledTrigger.update({ where: { id: trigger.id }, data: { lastRunAt: now, lastRunOk: false, lockedAt: null, lockedBy: null, enabled: false } });
      }
    }
  }
  return { fired, rescheduled: due.length };
}

/** Sets/refreshes nextRunAt the first time a CRON workflow is enabled or its schedule changes. */
export async function ensureScheduledTrigger(workflowId: string, cron: string, timezone: string): Promise<void> {
  const next = nextRunAt(cron, timezone, new Date());
  await prisma.engineScheduledTrigger.upsert({
    where: { workflowId },
    update: { cron, timezone, nextRunAt: next, enabled: true },
    create: { workflowId, cron, timezone, nextRunAt: next, enabled: true },
  });
}

const STALE_RUNNING_MS = 5 * 60_000;

/**
 * Recovery sweep: finds executions stuck RUNNING (a worker crashed mid-step, so no later status
 * update ever landed) or RETRYING/WAITING whose scheduled resume time has passed with no queue
 * job currently tracking them (e.g. a Redis flush lost the delayed job) — and re-enqueues them.
 * The executor's own idempotent-step-resume makes re-running always safe.
 */
export async function recoverStalledExecutions(): Promise<{ recovered: number }> {
  const queue = getExecutionRunQueue();
  const candidates = await prisma.engineExecution.findMany({
    where: {
      OR: [
        { status: EngineExecutionStatus.RUNNING, startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
        { status: EngineExecutionStatus.RETRYING, nextRetryAt: { lte: new Date() } },
        { status: EngineExecutionStatus.WAITING, nextRetryAt: { lte: new Date() } },
      ],
    },
    take: 100,
  });
  let recovered = 0;
  for (const execution of candidates) {
    const job = await queue.getJob(execution.id);
    const state = await job?.getState().catch(() => null);
    if (job && (state === "active" || state === "waiting" || state === "delayed")) continue; // genuinely still in flight
    await enqueueExecutionRun(execution.id);
    recovered++;
    logger.info({ executionId: execution.id, status: execution.status }, "[engine] recovered a stalled execution");
  }
  return { recovered };
}
