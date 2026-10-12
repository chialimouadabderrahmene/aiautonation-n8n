import { Queue, Worker, type Job } from "bullmq";
import { getConnection } from "../../lib/queue";
import { logger } from "../../lib/logger";

/**
 * Two queues, mirroring the two-stage pipeline:
 *   1. workflow-trigger-match — one job per fired trigger (webhook/event/cron). Matches it
 *      against enabled EngineWorkflow rows, creates one EngineExecution per match (idempotent
 *      on EngineExecution.idempotencyKey), and enqueues workflow-execution-run for each.
 *   2. workflow-execution-run — one job per EngineExecution; runs (or resumes) its steps.
 * Separate queues/concurrency so a burst of incoming triggers never starves running executions,
 * and so execution concurrency can be tuned independently of matching throughput.
 */

export const TRIGGER_MATCH_QUEUE_NAME = "workflow-trigger-match";
export const EXECUTION_RUN_QUEUE_NAME = "workflow-execution-run";

export interface TriggerMatchJobPayload {
  outboxId?: string; // present for EVENT triggers (traces back to the outbox row)
  eventType: string;
  payload: unknown;
  /** WEBHOOK/CRON/MANUAL triggers that don't go through the outbox set this instead. */
  source?: "webhook" | "cron" | "manual";
  workflowKey?: string; // WEBHOOK/CRON/MANUAL already know which single workflow to match
}

export interface ExecutionRunJobPayload {
  executionId: string;
}

let triggerMatchQueue: Queue<TriggerMatchJobPayload> | null = null;
let executionRunQueue: Queue<ExecutionRunJobPayload> | null = null;

export function getTriggerMatchQueue(): Queue<TriggerMatchJobPayload> {
  if (!triggerMatchQueue) triggerMatchQueue = new Queue(TRIGGER_MATCH_QUEUE_NAME, { connection: getConnection() });
  return triggerMatchQueue;
}

export function getExecutionRunQueue(): Queue<ExecutionRunJobPayload> {
  if (!executionRunQueue) executionRunQueue = new Queue(EXECUTION_RUN_QUEUE_NAME, { connection: getConnection() });
  return executionRunQueue;
}

export async function enqueueTriggerMatch(payload: TriggerMatchJobPayload): Promise<void> {
  await getTriggerMatchQueue().add("match", payload, {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 7 * 86_400 },
  });
}

/**
 * jobId = executionId makes an execution's active/waiting job unique — BullMQ refuses to enqueue
 * a second one, so an execution can never be picked up by two workers at once. A *finished*
 * job (completed or failed) with that same id is a leftover from a PREVIOUS attempt, not a
 * guard against this one: it is removed first (best-effort) so a retry/resume can always get a
 * fresh job with the same id instead of silently failing to enqueue (BullMQ rejects `add()` for
 * an id that still exists in any state, finished or not).
 */
export async function enqueueExecutionRun(executionId: string, delayMs = 0): Promise<void> {
  const queue = getExecutionRunQueue();
  const existing = await queue.getJob(executionId);
  if (existing) {
    const state = await existing.getState().catch(() => null);
    if (state === "completed" || state === "failed") await existing.remove().catch(() => undefined);
  }
  await queue.add(
    "run",
    { executionId },
    { jobId: executionId, delay: delayMs, attempts: 1, removeOnComplete: { age: 86_400 }, removeOnFail: { age: 7 * 86_400 } },
  );
}

let triggerWorker: Worker<TriggerMatchJobPayload> | null = null;
let executionWorker: Worker<ExecutionRunJobPayload> | null = null;

export function startEngineWorkers(
  matchHandler: (job: Job<TriggerMatchJobPayload>) => Promise<void>,
  runHandler: (job: Job<ExecutionRunJobPayload>) => Promise<void>,
  /** Invoked after an execution-run job has fully left BullMQ's active state (its "completed"
   * event) — the only safe point to enqueue that execution's own retry/resume, since `add()`
   * with a still-active duplicate jobId silently no-ops rather than scheduling anything. */
  onExecutionRunSettled?: (executionId: string) => Promise<void>,
): void {
  triggerWorker = new Worker<TriggerMatchJobPayload>(TRIGGER_MATCH_QUEUE_NAME, matchHandler, { connection: getConnection(), concurrency: 5 });
  executionWorker = new Worker<ExecutionRunJobPayload>(EXECUTION_RUN_QUEUE_NAME, runHandler, { connection: getConnection(), concurrency: 10 });
  for (const [name, w] of [["trigger-match", triggerWorker], ["execution-run", executionWorker]] as const) {
    w.on("error", (err) => logger.error({ worker: name, err: err.message }, "[engine] worker error"));
    w.on("failed", (job, err) => logger.warn({ worker: name, jobId: job?.id, err: err.message }, "[engine] job failed (queue-level)"));
  }
  if (onExecutionRunSettled) {
    executionWorker.on("completed", (job) => {
      void onExecutionRunSettled(job.data.executionId).catch((err) =>
        logger.error({ executionId: job.data.executionId, err: err instanceof Error ? err.message : String(err) }, "[engine] reconcileAfterRun failed"),
      );
    });
  }
}

export async function stopEngineWorkers(): Promise<void> {
  await Promise.all([triggerWorker?.close(), executionWorker?.close()]);
}
