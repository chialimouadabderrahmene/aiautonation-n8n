/**
 * REAL Postgres + Redis integration tests for the native workflow engine. Run explicitly:
 *   DATABASE_URL=... REDIS_URL=... npm run test:integration
 * Never run by `npm test` (see vitest.config.ts's exclude).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { ACTION_REGISTRY } from "../src/modules/engine/actions";
import { emitEvent, outboxRelayTick } from "../src/modules/engine/outbox";
import { matchTrigger } from "../src/modules/engine/matcher";
import { runExecution, cancelExecution, replayExecution } from "../src/modules/engine/executor";
import { cronSchedulerTick, ensureScheduledTrigger, recoverStalledExecutions } from "../src/modules/engine/scheduler";
import { getExecutionRunQueue, getTriggerMatchQueue, enqueueTriggerMatch } from "../src/modules/engine/queue";
import { nextRunAt } from "../src/modules/engine/cron";

const prisma = new PrismaClient();
const tag = `t${Date.now()}`;
let n = 0;
const uniq = () => `${tag}-${++n}`;

// --- test-only action: fails `failTimes` times (counted per executionId) then succeeds ---
// Registered directly into the exported ACTION_REGISTRY — a deliberate test seam, never
// shipped as a real action key (the "test." prefix is reserved for this file only).
const flakyCounters = new Map<string, number>();
ACTION_REGISTRY["test.flaky"] = {
  key: "test.flaky",
  idempotent: false,
  inputSchema: z.object({ id: z.string(), failTimes: z.number() }),
  async handler(input: { id: string; failTimes: number }) {
    const count = (flakyCounters.get(input.id) ?? 0) + 1;
    flakyCounters.set(input.id, count);
    if (count <= input.failTimes) throw new Error(`flaky failure ${count}/${input.failTimes}`);
    return { succeededOnAttempt: count };
  },
};
ACTION_REGISTRY["test.alwaysFails"] = {
  key: "test.alwaysFails",
  idempotent: false,
  inputSchema: z.object({}),
  async handler() {
    throw new Error("permanent failure");
  },
};
const sideEffectCounters = new Map<string, number>();
ACTION_REGISTRY["test.countSideEffect"] = {
  key: "test.countSideEffect",
  idempotent: false, // deliberately non-idempotent — proves the executor (not the action) gives idempotent resume
  inputSchema: z.object({ id: z.string() }),
  async handler(input: { id: string }) {
    sideEffectCounters.set(input.id, (sideEffectCounters.get(input.id) ?? 0) + 1);
    return { ok: true };
  },
};

async function makeWorkflow(key: string, triggerType: "EVENT" | "CRON" | "MANUAL", triggerConfig: object, definition: object) {
  const workflow = await prisma.engineWorkflow.create({
    data: { key, name: key, category: "LEAD_AUTOMATION", triggerType, triggerConfig, enabled: true, createdBy: "test" },
  });
  const version = await prisma.engineWorkflowVersion.create({
    data: { workflowId: workflow.id, version: 1, status: "PUBLISHED", definition, createdBy: "test", publishedAt: new Date(), publishedBy: "test" },
  });
  await prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { currentVersionId: version.id } });
  return workflow;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, intervalMs = 100): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

beforeAll(async () => {
  // Fresh tables every run: matchTrigger matches globally by eventType, so a leftover workflow
  // from a previous run would otherwise be matched again and inflate "created" counts.
  for (const table of ["EngineStepExecution", "EngineExecution", "EngineScheduledTrigger", "EngineWorkflowVersion", "EngineWorkflow", "EngineOutboxEvent", "EngineLead", "EngineWaitlistEntry", "EngineReferral", "EngineReferralCode", "EngineFeedbackRequest"]) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
  const { startEngineWorkers } = await import("../src/modules/engine/queue");
  const { matchTrigger: match } = await import("../src/modules/engine/matcher");
  const { runExecution: run, reconcileAfterRun } = await import("../src/modules/engine/executor");
  startEngineWorkers(
    async (job) => { await match(job.data); },
    async (job) => { await run(job.data.executionId); },
    reconcileAfterRun,
  );
}, 15_000);

afterAll(async () => {
  const { stopEngineWorkers } = await import("../src/modules/engine/queue");
  await stopEngineWorkers();
  await prisma.$disconnect();
});

describe("trigger matching + idempotency", () => {
  it("the SAME event emitted twice (duplicate delivery) creates exactly one execution", async () => {
    const eventKey = uniq();
    const workflow = await makeWorkflow(uniq(), "EVENT", { eventType: "lead.captured" }, {
      steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: eventKey } }],
    });
    const payload = { phone: "+391112223333" };
    const result = await prisma.$transaction((tx) => emitEvent(tx, "lead.captured", payload, eventKey));
    expect(result.deduped).toBe(false);
    const result2 = await prisma.$transaction((tx) => emitEvent(tx, "lead.captured", payload, eventKey));
    expect(result2.deduped).toBe(true); // outbox itself already dedupes on dedupeKey

    await outboxRelayTick();
    await outboxRelayTick(); // simulate a second relay tick racing the first — must not double-publish
    await waitFor(() => prisma.engineExecution.count({ where: { workflowId: workflow.id } }).then((c) => c === 1 ? c : null));
    await waitFor(() => sideEffectCounters.get(eventKey) === 1 || null);
    expect(sideEffectCounters.get(eventKey)).toBe(1);
  });

  it("matchTrigger itself is idempotent: calling it twice for the identical event never creates a 2nd execution", async () => {
    const dedupe = uniq();
    const workflow = await makeWorkflow(uniq(), "EVENT", { eventType: "waitlist.signup" }, {
      steps: [{ key: "s1", type: "action", action: "waitlist.add", input: { email: "{{trigger.email}}" } }],
    });
    const payload = { email: `${dedupe}@example.com` };
    const r1 = await matchTrigger({ eventType: "waitlist.signup", payload, outboxId: dedupe });
    const r2 = await matchTrigger({ eventType: "waitlist.signup", payload, outboxId: dedupe });
    expect(r1.created).toBe(1);
    expect(r2.created).toBe(0);
    expect(r2.deduped).toBe(1);
    const count = await prisma.engineExecution.count({ where: { workflowId: workflow.id } });
    expect(count).toBe(1);
  });

  it("concurrent duplicate matches (simulating two workers racing the same event) still produce exactly one execution", async () => {
    const dedupe = uniq();
    const workflow = await makeWorkflow(uniq(), "EVENT", { eventType: "feedback.submitted" }, {
      steps: [{ key: "s1", type: "action", action: "feedback.record", input: { leadPhone: "{{trigger.leadPhone}}", rating: "{{trigger.rating}}" } }],
    });
    const payload = { leadPhone: `+39${n}`, rating: 5 };
    const results = await Promise.all(Array.from({ length: 5 }, () => matchTrigger({ eventType: "feedback.submitted", payload, outboxId: dedupe })));
    const totalCreated = results.reduce((s, r) => s + r.created, 0);
    expect(totalCreated).toBe(1);
    const count = await prisma.engineExecution.count({ where: { workflowId: workflow.id } });
    expect(count).toBe(1);
  });
});

describe("condition branches", () => {
  it("onFalse=skip_remaining stops the rest of the steps at that level", async () => {
    const id = uniq();
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      steps: [
        { key: "gate", type: "condition", condition: { path: "trigger.allow", op: "eq", value: true }, onFalse: "skip_remaining" },
        { key: "effect", type: "action", action: "test.countSideEffect", input: { id } },
      ],
    });
    const execution = await prisma.engineExecution.create({
      data: { workflowId: workflow.id, versionId: (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!, status: "QUEUED", triggerType: "MANUAL", triggerPayload: { allow: false }, idempotencyKey: uniq(), correlationId: uniq() },
    });
    await runExecution(execution.id);
    const final = await prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(final.status).toBe("SUCCEEDED");
    expect(sideEffectCounters.get(id)).toBeUndefined(); // "effect" never ran
  });
});

describe("delay step + durable pause/resume", () => {
  it("pauses the execution (WAITING) and resumes after the delay, running the step exactly once", async () => {
    const id = uniq();
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      steps: [
        { key: "before", type: "action", action: "test.countSideEffect", input: { id: `${id}-before` } },
        { key: "wait", type: "delay", ms: 500 },
        { key: "after", type: "action", action: "test.countSideEffect", input: { id: `${id}-after` } },
      ],
    });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq() } });
    // Driven through the queue (not a direct runExecution() call) like a real execution always
    // is — the resume-after-delay path depends on the Worker's "completed" event.
    const { enqueueExecutionRun } = await import("../src/modules/engine/queue");
    await enqueueExecutionRun(execution.id);
    const mid = await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => e.status === "WAITING" ? e : null), 5000, 50);
    expect(mid.status).toBe("WAITING");
    expect(sideEffectCounters.get(`${id}-before`)).toBe(1);
    expect(sideEffectCounters.get(`${id}-after`)).toBeUndefined();

    await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => e.status === "SUCCEEDED" ? e : null), 5000);
    expect(sideEffectCounters.get(`${id}-before`)).toBe(1); // not re-run on resume
    expect(sideEffectCounters.get(`${id}-after`)).toBe(1);
  });
});

describe("retries, backoff, and recovery", () => {
  it("a transient failure retries and eventually succeeds, without re-running an already-succeeded earlier step", async () => {
    const id = uniq();
    const sideEffectId = uniq();
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      maxAttempts: 5,
      steps: [
        { key: "once", type: "action", action: "test.countSideEffect", input: { id: sideEffectId } },
        { key: "flaky", type: "action", action: "test.flaky", input: { id, failTimes: 2 } },
      ],
    });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq(), maxAttempts: 5 } });
    const { enqueueExecutionRun } = await import("../src/modules/engine/queue");
    await enqueueExecutionRun(execution.id);
    const final = await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => (e.status === "SUCCEEDED" || e.status === "FAILED") ? e : null), 60_000, 500);
    expect(final.status).toBe("SUCCEEDED");
    expect(final.attempt).toBeGreaterThanOrEqual(3); // failed twice, succeeded on the 3rd
    expect(sideEffectCounters.get(sideEffectId)).toBe(1); // the already-succeeded step is NEVER re-invoked by a retry
  }, 65_000);

  it("permanent failure exhausts maxAttempts and lands in the dead letter queue", async () => {
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      maxAttempts: 2,
      steps: [{ key: "boom", type: "action", action: "test.alwaysFails", input: {} }],
    });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq(), maxAttempts: 2 } });
    const { enqueueExecutionRun } = await import("../src/modules/engine/queue");
    await enqueueExecutionRun(execution.id);
    const final = await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => e.status === "FAILED" ? e : null), 30_000, 300);
    expect(final.deadLetter).toBe(true);
    expect(final.error).toContain("permanent failure");

    // Replay: a human retries it as a brand-new, auditable execution.
    const replay = await replayExecution(execution.id, "operator@test");
    expect(replay.ok).toBe(true);
    const replayed = await prisma.engineExecution.findUniqueOrThrow({ where: { id: replay.newExecutionId! } });
    expect(replayed.replayOfId).toBe(execution.id);
    // Still permanently failing — proves replay is a real, independent re-run, not a status flip.
    const replayFinal = await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: replay.newExecutionId! } }).then((e) => e.status === "FAILED" ? e : null), 30_000, 300);
    expect(replayFinal.deadLetter).toBe(true);
  }, 40_000);

  it("cannot replay an execution that is not actually failed", async () => {
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, { steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: uniq() } }] });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq() } });
    await runExecution(execution.id);
    const result = await replayExecution(execution.id, "operator@test");
    expect(result.ok).toBe(false);
  });
});

describe("cancellation", () => {
  it("a cancelled, in-flight (delayed) execution never runs its remaining steps", async () => {
    const id = uniq();
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      steps: [{ key: "wait", type: "delay", ms: 3000 }, { key: "after", type: "action", action: "test.countSideEffect", input: { id } }],
    });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq() } });
    const { enqueueExecutionRun } = await import("../src/modules/engine/queue");
    await enqueueExecutionRun(execution.id);
    await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => e.status === "WAITING" ? e : null), 5000, 100);
    const cancel = await cancelExecution(execution.id);
    expect(cancel.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 3500)); // past when the delay would have resumed it
    const final = await prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(final.status).toBe("CANCELLED");
    expect(sideEffectCounters.get(id)).toBeUndefined();
  }, 10_000);

  it("refuses to cancel an execution that already finished", async () => {
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, { steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: uniq() } }] });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq() } });
    await runExecution(execution.id);
    const result = await cancelExecution(execution.id);
    expect(result.ok).toBe(false);
  });
});

describe("crash recovery (stalled executions, no Redis job backing them)", () => {
  it("a RUNNING execution whose job disappeared (simulated crash) is detected and resumed, without re-running its already-succeeded step", async () => {
    const id = uniq();
    const workflow = await makeWorkflow(uniq(), "MANUAL", {}, {
      steps: [{ key: "done", type: "action", action: "test.countSideEffect", input: { id } }, { key: "more", type: "action", action: "test.countSideEffect", input: { id: `${id}-more` } }],
    });
    const version = (await prisma.engineWorkflow.findUniqueOrThrow({ where: { id: workflow.id } })).currentVersionId!;
    const execution = await prisma.engineExecution.create({ data: { workflowId: workflow.id, versionId: version, status: "QUEUED", triggerType: "MANUAL", triggerPayload: {}, idempotencyKey: uniq(), correlationId: uniq() } });

    // Simulate: worker completed step "done" then crashed before finishing — step row exists,
    // but the execution is stuck RUNNING with a startedAt old enough to look stale, and NO
    // BullMQ job exists for it any more (the crash happened after the job was marked complete-ish
    // or lost entirely).
    await prisma.engineStepExecution.create({ data: { executionId: execution.id, stepKey: "done", stepIndex: 0, type: "action", attempt: 1, status: "SUCCEEDED", output: { ok: true }, startedAt: new Date(), finishedAt: new Date() } });
    sideEffectCounters.set(id, 1); // the real handler really did run once, before the "crash"
    await prisma.engineExecution.update({ where: { id: execution.id }, data: { status: "RUNNING", startedAt: new Date(Date.now() - 10 * 60_000) } });

    const sweep = await recoverStalledExecutions();
    expect(sweep.recovered).toBeGreaterThanOrEqual(1);
    const final = await waitFor(() => prisma.engineExecution.findUniqueOrThrow({ where: { id: execution.id } }).then((e) => e.status === "SUCCEEDED" ? e : null), 10_000, 200);
    expect(final.status).toBe("SUCCEEDED");
    expect(sideEffectCounters.get(id)).toBe(1); // NOT re-run — idempotent resume from the persisted step
    expect(sideEffectCounters.get(`${id}-more`)).toBe(1); // the step after the crash point did run
  }, 15_000);
});

describe("scheduler: cron recovery after downtime, no double-fire", () => {
  it("a schedule whose nextRunAt is long in the past (simulated downtime) fires exactly once on the next tick", async () => {
    const key = uniq();
    const workflow = await makeWorkflow(key, "EVENT", { eventType: "report.weekly_due" }, {
      steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: key } }],
    });
    await ensureScheduledTrigger(workflow.id, "0 9 * * *", "UTC");
    // Simulate the API having been down since well before the scheduled time.
    await prisma.engineScheduledTrigger.update({ where: { workflowId: workflow.id }, data: { nextRunAt: new Date(Date.now() - 60 * 60_000) } });

    const r1 = await cronSchedulerTick();
    expect(r1.fired).toBe(1);
    const trigger = await prisma.engineScheduledTrigger.findUniqueOrThrow({ where: { workflowId: workflow.id } });
    expect(trigger.nextRunAt.getTime()).toBeGreaterThan(Date.now()); // advanced into the future
    expect(trigger.lockedAt).toBeNull(); // lock released

    // A second tick immediately after must NOT fire again (nextRunAt is now in the future).
    const r2 = await cronSchedulerTick();
    const stillOne = await waitFor(() => sideEffectCounters.get(key) === 1 ? true : null, 5000);
    expect(stillOne).toBe(true);
    void r2;
  }, 15_000);

  it("a row locked by a (simulated) crashed instance is reclaimed instead of staying stuck forever", async () => {
    const key = uniq();
    const workflow = await makeWorkflow(key, "EVENT", { eventType: "report.weekly_due" }, { steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: key } }] });
    await ensureScheduledTrigger(workflow.id, "0 9 * * *", "UTC");
    await prisma.engineScheduledTrigger.update({ where: { workflowId: workflow.id }, data: { nextRunAt: new Date(Date.now() - 1000), lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: "dead-instance" } });
    const r = await cronSchedulerTick();
    expect(r.fired).toBe(1);
  }, 10_000);
});

describe("outbox resilience to a queue outage", () => {
  it("a publish failure leaves the event PENDING (never lost) and a later tick delivers it", async () => {
    const dedupe = uniq();
    const workflow = await makeWorkflow(uniq(), "EVENT", { eventType: "lead.captured" }, { steps: [{ key: "s1", type: "action", action: "test.countSideEffect", input: { id: dedupe } }] });
    const row = await prisma.$transaction((tx) => emitEvent(tx, "lead.captured", { phone: "+39999" }, dedupe));

    // Simulate an outage: force the row's status back to PENDING with an elevated attempt count
    // the way a real failed publish would, then verify a normal tick still delivers it.
    await prisma.engineOutboxEvent.update({ where: { id: row.id }, data: { attempts: 3, lastError: "simulated Redis outage", status: "PENDING" } });
    const tick = await outboxRelayTick();
    expect(tick.published).toBeGreaterThanOrEqual(1);
    const fresh = await prisma.engineOutboxEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(fresh.status).toBe("PUBLISHED");
    await waitFor(() => prisma.engineExecution.count({ where: { workflowId: workflow.id } }).then((c) => c === 1 ? c : null));
  }, 10_000);
});
