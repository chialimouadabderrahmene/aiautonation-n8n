import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { getAction } from "./actions";
import { evaluateCondition } from "./conditions";
import { resolveInput } from "./templating";
import { validateDefinition, type StepDefinition, type WorkflowDefinition } from "./definition";
import { enqueueExecutionRun } from "./queue";
import { EngineExecutionStatus, EngineStepStatus, Prisma } from "@prisma/client";

export class StepTimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new StepTimeoutError(`Step timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Exponential backoff with jitter, bounded to a sane ceiling for a human-observable retry cadence. */
export function backoffMs(attempt: number): number {
  const base = 10_000; // 10s
  const capped = Math.min(base * 2 ** (attempt - 1), 30 * 60_000); // cap at 30 minutes
  return capped + Math.floor(Math.random() * 2_000);
}

type Ctx = Record<string, unknown>;

/** Why a step loop stopped early without throwing — distinct from a normal fall-through
 * completion, so the caller never has to guess from side-channel DB state. */
type RunOutcome = "completed" | "cancelled" | "paused";

/** Runs (or resumes) one list of steps, mutating `ctx` with each action's output under its step key. */
async function runSteps(executionId: string, steps: StepDefinition[], ctx: Ctx): Promise<RunOutcome> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    // Cooperative cancellation: checked before every step so a cancel takes effect promptly
    // without aborting mid-action-call.
    const current = await prisma.engineExecution.findUniqueOrThrow({ where: { id: executionId }, select: { status: true } });
    if (current.status === EngineExecutionStatus.CANCELLED) return "cancelled";

    if (step.type === "condition") {
      const result = evaluateCondition(ctx, step.condition);
      await recordStep(executionId, step.key, i, "condition", 1, EngineStepStatus.SUCCEEDED, { condition: step.condition }, { result });
      ctx[step.key] = { result };
      if (!result && step.onFalse === "skip_remaining") return "completed"; // this LEVEL is done, not cancelled/paused
      continue;
    }

    if (step.type === "delay") {
      const already = await prisma.engineStepExecution.findFirst({ where: { executionId, stepKey: step.key, status: EngineStepStatus.SUCCEEDED } });
      if (already) continue; // resumed after the delay elapsed — move on
      const resumeAt = new Date(Date.now() + step.ms);
      await recordStep(executionId, step.key, i, "delay", 1, EngineStepStatus.SUCCEEDED, { ms: step.ms }, { resumeAt: resumeAt.toISOString() });
      await prisma.engineExecution.update({ where: { id: executionId }, data: { status: EngineExecutionStatus.WAITING, nextRetryAt: resumeAt, cursorStepKey: step.key } });
      // Deliberately NOT enqueuing the resume here: this step runs inside the CURRENT job's
      // still-active processor call, and BullMQ silently no-ops `add()` for a jobId that is
      // still active (see reconcileAfterRun's doc comment) — scheduling the resume only happens
      // once this job has fully left the active state, via the Worker's "completed" listener.
      return "paused";
    }

    if (step.type === "parallel") {
      try {
        // Sequential-but-isolated execution of each branch (documented limitation — see
        // definition.ts). A branch's own steps still get full idempotent-resume support.
        for (const branch of step.branches) {
          const r = await runSteps(executionId, [branch], ctx);
          if (r !== "completed") return r;
        }
      } catch (err) {
        if (step.onFailure === "continue") {
          logger.warn({ executionId, step: step.key, err: err instanceof Error ? err.message : String(err) }, "[engine] parallel branch failed, continuing (onFailure=continue)");
          continue;
        }
        throw err;
      }
      continue;
    }

    // action — the only StepDefinition variant not handled (and `continue`d/`return`ed) above.
    const a = step;
    if (a.condition && !evaluateCondition(ctx, a.condition)) {
      await recordStep(executionId, step.key, i, "action", 1, EngineStepStatus.SKIPPED, null, { reason: "condition false" });
      ctx[step.key] = { skipped: true };
      continue;
    }
    const existing = await prisma.engineStepExecution.findFirst({ where: { executionId, stepKey: step.key, status: EngineStepStatus.SUCCEEDED }, orderBy: { attempt: "desc" } });
    if (existing) {
      // Idempotent resume: this step already completed in a previous (crashed) attempt at this
      // execution — reuse its recorded output rather than re-invoking a non-idempotent send.
      ctx[step.key] = existing.output;
      continue;
    }
    const def = getAction(a.action);
    if (!def) throw new Error(`Unknown action "${a.action}" referenced by step "${step.key}" — the published definition is invalid.`);
    const resolvedInput = resolveInput(a.input, ctx);
    const parsed = def.inputSchema.safeParse(resolvedInput);
    if (!parsed.success) {
      const msg = `Action "${a.action}" input invalid at step "${step.key}": ${parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`;
      await recordStep(executionId, step.key, i, "action", 1, EngineStepStatus.FAILED, resolvedInput, null, msg);
      if (a.onFailure === "continue") { ctx[step.key] = { error: msg }; continue; }
      throw new Error(msg);
    }
    const priorAttempts = await prisma.engineStepExecution.count({ where: { executionId, stepKey: step.key } });
    const attempt = priorAttempts + 1;
    try {
      const output = await withTimeout(def.handler(parsed.data), a.timeoutMs);
      await recordStep(executionId, step.key, i, "action", attempt, EngineStepStatus.SUCCEEDED, resolvedInput, output);
      ctx[step.key] = output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordStep(executionId, step.key, i, "action", attempt, EngineStepStatus.FAILED, resolvedInput, null, message);
      if (a.onFailure === "continue") { ctx[step.key] = { error: message }; continue; }
      throw new Error(message);
    }
  }
  return "completed";
}

async function recordStep(
  executionId: string, stepKey: string, stepIndex: number, type: string, attempt: number,
  status: EngineStepStatus, input: unknown, output: unknown, error?: string,
): Promise<void> {
  const now = new Date();
  await prisma.engineStepExecution.upsert({
    where: { executionId_stepKey_attempt: { executionId, stepKey, attempt } },
    update: { status, output: output as Prisma.InputJsonValue, error, finishedAt: now },
    create: {
      executionId, stepKey, stepIndex, type, attempt, status,
      input: input === null || input === undefined ? Prisma.JsonNull : (input as Prisma.InputJsonValue),
      output: output === null || output === undefined ? Prisma.JsonNull : (output as Prisma.InputJsonValue),
      error, startedAt: now, finishedAt: now,
    },
  });
}

/**
 * Runs (or resumes) one execution end-to-end. Safe to call more than once concurrently for the
 * same executionId in the sense that each step is individually idempotent-checked, but the
 * queue's jobId=executionId already prevents true concurrent runs under normal operation.
 */
export async function runExecution(executionId: string): Promise<void> {
  const execution = await prisma.engineExecution.findUnique({ where: { id: executionId }, include: { version: true, workflow: true } });
  if (!execution) { logger.warn({ executionId }, "[engine] runExecution: execution not found"); return; }
  if ((["SUCCEEDED","CANCELLED","FAILED"] as EngineExecutionStatus[]).includes(execution.status)) return;

  const parsed = validateDefinition(execution.version.definition);
  if (!parsed.ok) {
    await prisma.engineExecution.update({ where: { id: executionId }, data: { status: EngineExecutionStatus.FAILED, deadLetter: true, error: `Invalid definition: ${parsed.errors.join("; ")}`, finishedAt: new Date() } });
    return;
  }
  const definition: WorkflowDefinition = parsed.definition;

  await prisma.engineExecution.update({ where: { id: executionId }, data: { status: EngineExecutionStatus.RUNNING } });
  const ctx: Ctx = { trigger: execution.triggerPayload, ...((execution.context as Ctx) ?? {}) };

  try {
    const result = await runSteps(executionId, definition.steps, ctx);
    if (result === "paused") return; // the delay step already transitioned this execution to WAITING
    if (result === "cancelled") {
      await prisma.engineExecution.update({ where: { id: executionId }, data: { status: EngineExecutionStatus.CANCELLED, finishedAt: new Date() } });
      return;
    }
    await prisma.engineExecution.update({
      where: { id: executionId },
      data: { status: EngineExecutionStatus.SUCCEEDED, context: ctx as Prisma.InputJsonValue, finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextAttempt = execution.attempt + 1;
    if (nextAttempt <= execution.maxAttempts) {
      const delay = backoffMs(execution.attempt);
      await prisma.engineExecution.update({
        where: { id: executionId },
        data: { status: EngineExecutionStatus.RETRYING, attempt: nextAttempt, error: message, nextRetryAt: new Date(Date.now() + delay), context: ctx as Prisma.InputJsonValue },
      });
      // Deliberately NOT enqueuing the retry here — see reconcileAfterRun's doc comment: this
      // function is itself still running inside the CURRENT (about to complete) job's processor,
      // and BullMQ will not actually schedule a same-id job while that one is still active.
      logger.info({ executionId, nextAttempt, delay, err: message }, "[engine] step failed, scheduled retry");
    } else {
      await prisma.engineExecution.update({
        where: { id: executionId },
        data: { status: EngineExecutionStatus.FAILED, deadLetter: true, error: message, finishedAt: new Date(), context: ctx as Prisma.InputJsonValue },
      });
      logger.warn({ executionId, err: message }, "[engine] execution dead-lettered (max attempts exhausted)");
    }
  }
}

/**
 * Called once the execution-run job for `executionId` has FULLY left BullMQ's active state
 * (i.e. from the Worker's "completed" event, never from inside runExecution/runSteps itself).
 * This is the only place that enqueues a retry (status RETRYING) or a delay resume (status
 * WAITING): BullMQ silently refuses to actually (re)schedule a job whose id is still active —
 * `queue.add()` with a duplicate active id returns a stale handle instead of throwing, so
 * calling it from inside the still-running processor would schedule nothing and the execution
 * would simply never resume. Deferring to "completed" avoids that race entirely.
 */
export async function reconcileAfterRun(executionId: string): Promise<void> {
  const execution = await prisma.engineExecution.findUnique({ where: { id: executionId }, select: { status: true, nextRetryAt: true } });
  if (!execution) return;
  if (execution.status !== EngineExecutionStatus.RETRYING && execution.status !== EngineExecutionStatus.WAITING) return;
  const delay = execution.nextRetryAt ? Math.max(0, execution.nextRetryAt.getTime() - Date.now()) : 0;
  await enqueueExecutionRun(executionId, delay);
}

/** Admin-initiated: a human requests this exact execution stop. Cooperative — takes effect at
 * the next step boundary, never mid-action. */
export async function cancelExecution(executionId: string): Promise<{ ok: boolean; message?: string }> {
  const execution = await prisma.engineExecution.findUnique({ where: { id: executionId } });
  if (!execution) return { ok: false, message: "Execution not found" };
  if ((["SUCCEEDED","FAILED","CANCELLED"] as EngineExecutionStatus[]).includes(execution.status)) {
    return { ok: false, message: `Cannot cancel an execution that is already ${execution.status}` };
  }
  await prisma.engineExecution.update({ where: { id: executionId }, data: { status: EngineExecutionStatus.CANCELLED, finishedAt: new Date() } });
  const { getExecutionRunQueue } = await import("./queue");
  const job = await getExecutionRunQueue().getJob(executionId);
  await job?.remove().catch(() => undefined); // best-effort: drop a pending delayed/retry job for it
  return { ok: true };
}

/** Admin-initiated: re-runs a dead-lettered execution from scratch as a brand-new, auditable
 * execution (never mutates history) with a fresh attempt budget. */
export async function replayExecution(executionId: string, requestedBy: string): Promise<{ ok: boolean; newExecutionId?: string; message?: string }> {
  const original = await prisma.engineExecution.findUnique({ where: { id: executionId } });
  if (!original) return { ok: false, message: "Execution not found" };
  if (!original.deadLetter && original.status !== EngineExecutionStatus.FAILED) return { ok: false, message: "Only a failed/dead-lettered execution can be replayed" };
  const replay = await prisma.engineExecution.create({
    data: {
      workflowId: original.workflowId, versionId: original.versionId, status: EngineExecutionStatus.QUEUED,
      triggerType: original.triggerType, triggerPayload: original.triggerPayload as Prisma.InputJsonValue,
      idempotencyKey: `${original.idempotencyKey}:replay:${Date.now()}`, correlationId: original.correlationId,
      maxAttempts: original.maxAttempts, requestedBy, replayOfId: original.id,
    },
  });
  await enqueueExecutionRun(replay.id);
  return { ok: true, newExecutionId: replay.id };
}
