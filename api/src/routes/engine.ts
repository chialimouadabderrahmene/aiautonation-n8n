import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { validateDefinition, checkActionReferences } from "../modules/engine/definition";
import { ACTION_REGISTRY } from "../modules/engine/actions";
import { EVENT_SCHEMAS } from "../modules/engine/triggers";
import { enqueueExecutionRun } from "../modules/engine/queue";
import { cancelExecution, replayExecution } from "../modules/engine/executor";
import { ensureScheduledTrigger, cronSchedulerTick } from "../modules/engine/scheduler";
import { getExecutionRunQueue, getTriggerMatchQueue } from "../modules/engine/queue";
import { engineSchedulerStatus } from "../modules/engine/bootstrap";
import crypto from "node:crypto";

export const engineRouter = Router();

function actor(req: AuthedRequest): string {
  return req.admin?.email ?? "unknown";
}

function knownActionKeys(): Set<string> {
  return new Set(Object.keys(ACTION_REGISTRY));
}

// ─── Workflows ──────────────────────────────────────────────────────────────

engineRouter.get("/workflows", async (_req, res) => {
  const workflows = await prisma.engineWorkflow.findMany({
    include: {
      currentVersion: { select: { version: true, status: true, publishedAt: true } },
      _count: { select: { versions: true, executions: true } },
      schedule: { select: { nextRunAt: true, lastRunAt: true, lastRunOk: true, enabled: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const withLast = await Promise.all(
    workflows.map(async (w) => {
      const last = await prisma.engineExecution.findFirst({ where: { workflowId: w.id }, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true } });
      return { ...w, lastExecution: last };
    }),
  );
  res.json(withLast);
});

engineRouter.get("/workflows/:key", async (req, res) => {
  const workflow = await prisma.engineWorkflow.findUnique({
    where: { key: String(req.params.key) },
    include: { versions: { orderBy: { version: "desc" } }, schedule: true },
  });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  res.json(workflow);
});

const createWorkflowSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9-]+$/, "lowercase letters, digits and hyphens only"),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.enum(["SYSTEM", "CONTENT", "LEAD_AUTOMATION", "WHATSAPP", "SOCIAL", "AI", "REPORTING"]),
  triggerType: z.enum(["WEBHOOK", "EVENT", "CRON", "MANUAL"]),
  triggerConfig: z.record(z.unknown()),
  definition: z.record(z.unknown()),
});

engineRouter.post("/workflows", async (req: AuthedRequest, res) => {
  const parsed = createWorkflowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  const { key, name, description, category, triggerType, triggerConfig, definition } = parsed.data;

  if (triggerType === "EVENT") {
    const eventType = (triggerConfig as { eventType?: string }).eventType;
    if (!eventType || !(eventType in EVENT_SCHEMAS)) return res.status(400).json({ message: `triggerConfig.eventType must be one of: ${Object.keys(EVENT_SCHEMAS).join(", ")}` });
  }
  if (triggerType === "CRON") {
    const { cron, timezone } = triggerConfig as { cron?: string; timezone?: string };
    if (!cron) return res.status(400).json({ message: "triggerConfig.cron is required for a CRON workflow" });
    try {
      const { parseCron } = await import("../modules/engine/cron");
      parseCron(cron);
    } catch (err) {
      return res.status(400).json({ message: err instanceof Error ? err.message : "Invalid cron expression" });
    }
    void timezone;
  }

  const defResult = validateDefinition(definition);
  if (!defResult.ok) return res.status(400).json({ message: defResult.errors.join("; ") });
  const unknownActions = checkActionReferences(defResult.definition, knownActionKeys());
  if (unknownActions.length) return res.status(400).json({ message: `Unknown action(s): ${unknownActions.join(", ")}` });

  const existing = await prisma.engineWorkflow.findUnique({ where: { key } });
  if (existing) return res.status(409).json({ message: `Workflow "${key}" already exists` });

  const workflow = await prisma.engineWorkflow.create({ data: { key, name, description, category, triggerType, triggerConfig: triggerConfig as Prisma.InputJsonValue, enabled: false, createdBy: actor(req) } });
  const version = await prisma.engineWorkflowVersion.create({ data: { workflowId: workflow.id, version: 1, status: "DRAFT", definition: definition as Prisma.InputJsonValue, createdBy: actor(req) } });
  await recordAudit(actor(req), "engine.workflow.created", "EngineWorkflow", key, { versionId: version.id });
  res.status(201).json({ workflow, version });
});

const newVersionSchema = z.object({ definition: z.record(z.unknown()), notes: z.string().optional() });

engineRouter.post("/workflows/:key/versions", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  const parsed = newVersionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  const defResult = validateDefinition(parsed.data.definition);
  if (!defResult.ok) return res.status(400).json({ message: defResult.errors.join("; ") });
  const unknownActions = checkActionReferences(defResult.definition, knownActionKeys());
  if (unknownActions.length) return res.status(400).json({ message: `Unknown action(s): ${unknownActions.join(", ")}` });

  const latest = await prisma.engineWorkflowVersion.findFirst({ where: { workflowId: workflow.id }, orderBy: { version: "desc" } });
  const version = await prisma.engineWorkflowVersion.create({
    data: { workflowId: workflow.id, version: (latest?.version ?? 0) + 1, status: "DRAFT", definition: parsed.data.definition as Prisma.InputJsonValue, notes: parsed.data.notes, createdBy: actor(req) },
  });
  await recordAudit(actor(req), "engine.workflow.version_drafted", "EngineWorkflowVersion", version.id, { workflowKey: key, version: version.version });
  res.status(201).json(version);
});

/**
 * Publishing is the ONLY way a version becomes live — never editable afterwards (immutable).
 * In-flight executions keep running against whichever version they already started with
 * (EngineExecution.versionId is fixed at creation time), so a publish never changes the
 * behaviour of an execution already under way.
 */
engineRouter.post("/workflows/:key/versions/:version/publish", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  const version = await prisma.engineWorkflowVersion.findUnique({ where: { workflowId_version: { workflowId: workflow.id, version: Number(req.params.version) } } });
  if (!version) return res.status(404).json({ message: "Version not found" });
  if (version.status !== "DRAFT") return res.status(409).json({ message: `Only a DRAFT version can be published (this one is ${version.status})` });
  const defResult = validateDefinition(version.definition);
  if (!defResult.ok) return res.status(400).json({ message: `Definition no longer validates: ${defResult.errors.join("; ")}` });
  const unknownActions = checkActionReferences(defResult.definition, knownActionKeys());
  if (unknownActions.length) return res.status(400).json({ message: `Unknown action(s): ${unknownActions.join(", ")}` });

  await prisma.$transaction([
    prisma.engineWorkflowVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", publishedAt: new Date(), publishedBy: actor(req) } }),
    prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { currentVersionId: version.id } }),
  ]);
  if (workflow.triggerType === "CRON") {
    const { cron, timezone } = workflow.triggerConfig as { cron: string; timezone?: string };
    await ensureScheduledTrigger(workflow.id, cron, timezone ?? "UTC");
  }
  await recordAudit(actor(req), "engine.workflow.version_published", "EngineWorkflowVersion", version.id, { workflowKey: key, version: version.version });
  res.json({ ok: true });
});

/** Rolls back to a PREVIOUSLY published version — never resurrects a version in place; it just
 * repoints currentVersionId, so the full history (including the version being rolled back
 * from) stays intact and auditable. */
engineRouter.post("/workflows/:key/versions/:version/rollback", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  const target = await prisma.engineWorkflowVersion.findUnique({ where: { workflowId_version: { workflowId: workflow.id, version: Number(req.params.version) } } });
  if (!target || target.status !== "PUBLISHED") return res.status(409).json({ message: "Can only roll back to a version that was itself published" });
  await prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { currentVersionId: target.id } });
  await recordAudit(actor(req), "engine.workflow.rolled_back", "EngineWorkflow", key, { toVersion: target.version });
  res.json({ ok: true });
});

engineRouter.post("/workflows/:key/enable", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key }, include: { currentVersion: true } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  if (!workflow.currentVersion || workflow.currentVersion.status !== "PUBLISHED") return res.status(409).json({ message: "Workflow has no published version to run" });
  await prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { enabled: true } });
  if (workflow.triggerType === "CRON") await prisma.engineScheduledTrigger.updateMany({ where: { workflowId: workflow.id }, data: { enabled: true } });
  await recordAudit(actor(req), "engine.workflow.enabled", "EngineWorkflow", key);
  res.json({ ok: true });
});

engineRouter.post("/workflows/:key/disable", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  await prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { enabled: false } });
  if (workflow.triggerType === "CRON") await prisma.engineScheduledTrigger.updateMany({ where: { workflowId: workflow.id }, data: { enabled: false } });
  await recordAudit(actor(req), "engine.workflow.disabled", "EngineWorkflow", key);
  res.json({ ok: true, message: "Disabled. In-flight executions are not affected and will finish normally." });
});

/** Manual test run: creates a REAL, auditable execution against the published version with
 * admin-supplied sample payload. This executes real actions (no simulated/mocked send) —
 * never claim "tested" without having actually watched this execution's result. */
engineRouter.post("/workflows/:key/test-run", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key }, include: { currentVersion: true } });
  if (!workflow) return res.status(404).json({ message: "Workflow not found" });
  if (!workflow.currentVersion || workflow.currentVersion.status !== "PUBLISHED") return res.status(409).json({ message: "Workflow has no published version" });
  const payload = (req.body as { payload?: unknown })?.payload ?? {};
  const execution = await prisma.engineExecution.create({
    data: {
      workflowId: workflow.id, versionId: workflow.currentVersion.id, status: "QUEUED", triggerType: "MANUAL",
      triggerPayload: payload as never, idempotencyKey: `manual:${workflow.id}:${crypto.randomUUID()}`, correlationId: crypto.randomUUID(),
      requestedBy: actor(req), maxAttempts: (workflow.currentVersion.definition as { maxAttempts?: number }).maxAttempts ?? 3,
    },
  });
  await enqueueExecutionRun(execution.id);
  await recordAudit(actor(req), "engine.workflow.test_run", "EngineWorkflow", key, { executionId: execution.id });
  res.status(202).json({ executionId: execution.id, message: "Queued. This runs real actions — watch the execution for its real result." });
});

// ─── Action/event registries (for building the definition JSON) ───────────

engineRouter.get("/actions", (_req, res) => {
  res.json(Object.keys(ACTION_REGISTRY).filter((k) => !k.startsWith("test.")).map((key) => ({ key, idempotent: ACTION_REGISTRY[key]!.idempotent })));
});
engineRouter.get("/event-types", (_req, res) => {
  res.json(Object.keys(EVENT_SCHEMAS));
});

// ─── Executions ─────────────────────────────────────────────────────────────

const EXEC_STATUSES = ["QUEUED", "RUNNING", "WAITING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

engineRouter.get("/executions", async (req, res) => {
  const { status, workflowKey, deadLetter, cursor } = req.query as Record<string, string | undefined>;
  const take = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const workflow = workflowKey ? await prisma.engineWorkflow.findUnique({ where: { key: workflowKey } }) : null;
  const executions = await prisma.engineExecution.findMany({
    where: {
      ...(status && (EXEC_STATUSES as readonly string[]).includes(status) ? { status: status as (typeof EXEC_STATUSES)[number] } : {}),
      ...(workflow ? { workflowId: workflow.id } : {}),
      ...(deadLetter === "true" ? { deadLetter: true } : {}),
    },
    include: { workflow: { select: { key: true, name: true } } },
    orderBy: { startedAt: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = executions.length > take;
  const items = executions.slice(0, take);
  res.json({ items, nextCursor: hasMore ? items[items.length - 1]?.id : null });
});

engineRouter.get("/executions/:id", async (req, res) => {
  const execution = await prisma.engineExecution.findUnique({
    where: { id: String(req.params.id) },
    include: { workflow: { select: { key: true, name: true } }, version: { select: { version: true } }, steps: { orderBy: [{ stepIndex: "asc" }, { attempt: "asc" }] } },
  });
  if (!execution) return res.status(404).json({ message: "Not found" });
  res.json(execution);
});

engineRouter.post("/executions/:id/cancel", async (req: AuthedRequest, res) => {
  const result = await cancelExecution(String(req.params.id));
  if (!result.ok) return res.status(409).json({ message: result.message });
  await recordAudit(actor(req), "engine.execution.cancelled", "EngineExecution", String(req.params.id));
  res.json({ ok: true });
});

engineRouter.post("/executions/:id/replay", async (req: AuthedRequest, res) => {
  const result = await replayExecution(String(req.params.id), actor(req));
  if (!result.ok) return res.status(409).json({ message: result.message });
  await recordAudit(actor(req), "engine.execution.replayed", "EngineExecution", String(req.params.id), { newExecutionId: result.newExecutionId });
  res.status(202).json({ executionId: result.newExecutionId });
});

// ─── Scheduler / queue health ───────────────────────────────────────────────

engineRouter.get("/scheduler/health", async (_req, res) => {
  const triggers = await prisma.engineScheduledTrigger.findMany({ include: { workflow: { select: { key: true, name: true, enabled: true } } }, orderBy: { nextRunAt: "asc" } });
  res.json({ background: engineSchedulerStatus(), triggers });
});

engineRouter.post("/scheduler/run-now", async (req: AuthedRequest, res) => {
  const result = await cronSchedulerTick();
  await recordAudit(actor(req), "engine.scheduler.manual_tick", undefined, undefined, result);
  res.json(result);
});

engineRouter.get("/queue/health", async (_req, res) => {
  const [triggerCounts, execCounts] = await Promise.all([getTriggerMatchQueue().getJobCounts(), getExecutionRunQueue().getJobCounts()]);
  const deadLetterCount = await prisma.engineExecution.count({ where: { deadLetter: true, status: "FAILED" } });
  res.json({ triggerMatchQueue: triggerCounts, executionRunQueue: execCounts, deadLetterCount });
});

engineRouter.get("/dead-letter", async (_req, res) => {
  const items = await prisma.engineExecution.findMany({
    where: { deadLetter: true, status: "FAILED" },
    include: { workflow: { select: { key: true, name: true } } },
    orderBy: { finishedAt: "desc" },
    take: 100,
  });
  res.json(items);
});

// ─── Content drafts (AI-generated, from content-multiplication-engine / social-proof-engine
// / the future content-calendar workflow) — the human review step n8n's Telegram-approval
// workflow (02) used to do. Approve/reject here is itself the review action; nothing is ever
// auto-published from a draft row. ───────────────────────────────────────────

const CONTENT_DRAFT_STATUSES = ["DRAFT", "QUEUED", "APPROVED", "REJECTED", "PUBLISHED"] as const;

engineRouter.get("/content-drafts", async (req, res) => {
  const { status, source } = req.query as Record<string, string | undefined>;
  const items = await prisma.engineContentDraft.findMany({
    where: {
      ...(status && (CONTENT_DRAFT_STATUSES as readonly string[]).includes(status) ? { status: status as (typeof CONTENT_DRAFT_STATUSES)[number] } : {}),
      ...(source ? { source } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(items);
});

engineRouter.post("/content-drafts/:id/approve", async (req: AuthedRequest, res) => {
  const draft = await prisma.engineContentDraft.findUnique({ where: { id: String(req.params.id) } });
  if (!draft) return res.status(404).json({ message: "Draft not found" });
  if (draft.status !== "DRAFT" && draft.status !== "QUEUED") return res.status(409).json({ message: `Only a DRAFT/QUEUED draft can be approved (this one is ${draft.status})` });
  await prisma.engineContentDraft.update({ where: { id: draft.id }, data: { status: "APPROVED", reviewedAt: new Date(), reviewedBy: actor(req) } });
  await recordAudit(actor(req), "engine.content_draft.approved", "EngineContentDraft", draft.id, { source: draft.source });
  res.json({ ok: true, message: "Approved. No native action publishes it anywhere yet — see docs/WORKFLOW_ENGINE.md for what remains out of scope." });
});

engineRouter.post("/content-drafts/:id/reject", async (req: AuthedRequest, res) => {
  const draft = await prisma.engineContentDraft.findUnique({ where: { id: String(req.params.id) } });
  if (!draft) return res.status(404).json({ message: "Draft not found" });
  if (draft.status !== "DRAFT" && draft.status !== "QUEUED") return res.status(409).json({ message: `Only a DRAFT/QUEUED draft can be rejected (this one is ${draft.status})` });
  const note = (req.body as { note?: string })?.note;
  await prisma.engineContentDraft.update({ where: { id: draft.id }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: actor(req), reviewNote: note } });
  await recordAudit(actor(req), "engine.content_draft.rejected", "EngineContentDraft", draft.id, { source: draft.source, note });
  res.json({ ok: true });
});
