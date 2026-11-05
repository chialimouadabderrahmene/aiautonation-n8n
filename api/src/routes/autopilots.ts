import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { enqueueExecutionRun } from "../modules/engine/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { evaluateRequirements } from "../modules/workflows/readiness";
import { getEmergencyStopState } from "../lib/outbound-guard";
import { isPracticeMode } from "../lib/practice";
import { AUTOPILOTS, AutopilotDefinition, findAutopilot, isAutopilotOn } from "../modules/autopilots/catalog";

export const autopilotsRouter = Router();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Requirement labels are written for the settings page; these read naturally in "Needs X". */
const PLAIN: Record<string, string> = { "setting:whatsappTemplatesApproved": "Meta's approval of your WhatsApp templates", "field:resend.teamEmail": "your team's email address" };
const plainLabel = (d: { requirement: string; label: string }) => PLAIN[d.requirement] ?? d.label.replace(" Cloud API", "").replace(" or Groq or CodeCraft API", ", Groq or CodeCraft");

async function describe(a: AutopilotDefinition) {
  const rows = await prisma.engineWorkflow.findMany({ where: { key: { in: a.workflows } }, select: { id: true, key: true, name: true, enabled: true, triggerType: true } });
  const ids = rows.map((r) => r.id);
  const [lastRun, runsThisWeek, failedThisWeek, needs] = await Promise.all([
    prisma.engineExecution.findFirst({ where: { workflowId: { in: ids } }, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, error: true, id: true } }),
    prisma.engineExecution.count({ where: { workflowId: { in: ids }, startedAt: { gte: new Date(Date.now() - WEEK_MS) } } }),
    prisma.engineExecution.count({ where: { workflowId: { in: ids }, status: "FAILED", startedAt: { gte: new Date(Date.now() - WEEK_MS) } } }),
    evaluateRequirements(a.needs),
  ]);
  return {
    id: a.id, title: a.title, promise: a.promise, when: a.when, steps: a.steps,
    on: isAutopilotOn(a, rows),
    canRun: needs.readiness === "READY",
    missing: needs.detail.filter((d) => !d.ok).map((d) => ({ label: plainLabel(d), fix: d.note ?? "" })),
    workflows: rows.map((r) => ({ key: r.key, name: r.name, enabled: r.enabled })),
    lastRun,
    runsThisWeek,
    failedThisWeek,
  };
}

autopilotsRouter.get("/", async (_req, res) => {
  const [items, stop, practice] = await Promise.all([Promise.all(AUTOPILOTS.map(describe)), getEmergencyStopState(), isPracticeMode()]);
  res.json({ items, stopped: stop.active, practice });
});

autopilotsRouter.post("/:id/on", async (req: AuthedRequest, res) => {
  const a = findAutopilot(String(req.params.id));
  if (!a) return res.status(404).json({ message: "Autopilot not found" });
  const needs = await evaluateRequirements(a.needs);
  if (needs.readiness !== "READY") {
    return res.status(409).json({ message: `Needs ${needs.detail.filter((d) => !d.ok).map(plainLabel).join(" and ")} first.`, missing: needs.detail.filter((d) => !d.ok) });
  }
  const rows = await prisma.engineWorkflow.findMany({ where: { key: { in: a.workflows } }, select: { id: true } });
  await prisma.engineWorkflow.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { enabled: true } });
  await prisma.engineScheduledTrigger.updateMany({ where: { workflowId: { in: rows.map((r) => r.id) } }, data: { enabled: true } });
  await recordAudit(req.admin?.email ?? "unknown", "autopilot.on", "Autopilot", a.id);
  res.json(await describe(a));
});

autopilotsRouter.post("/:id/off", async (req: AuthedRequest, res) => {
  const a = findAutopilot(String(req.params.id));
  if (!a) return res.status(404).json({ message: "Autopilot not found" });
  const rows = await prisma.engineWorkflow.findMany({ where: { key: { in: a.workflows } }, select: { id: true } });
  await prisma.engineWorkflow.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { enabled: false } });
  await prisma.engineScheduledTrigger.updateMany({ where: { workflowId: { in: rows.map((r) => r.id) } }, data: { enabled: false } });
  await recordAudit(req.admin?.email ?? "unknown", "autopilot.off", "Autopilot", a.id);
  res.json(await describe(a));
});

/** "Try it now": a real run of the job's main workflow, so the team can see it work on demand. */
autopilotsRouter.post("/:id/run", async (req: AuthedRequest, res) => {
  const a = findAutopilot(String(req.params.id));
  if (!a) return res.status(404).json({ message: "Autopilot not found" });
  const needs = await evaluateRequirements(a.needs);
  if (needs.readiness !== "READY") return res.status(409).json({ message: `Needs ${needs.detail.filter((d) => !d.ok).map(plainLabel).join(" and ")} first.` });
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key: a.primary }, include: { currentVersion: true } });
  if (!workflow?.currentVersion) return res.status(409).json({ message: "This autopilot has no published version yet." });
  const samplePayload = a.primary === "waitlist-management" ? { email: `sample+${Date.now()}@example.com`, name: "Sample person" } : {};
  const execution = await prisma.engineExecution.create({
    data: {
      workflowId: workflow.id, versionId: workflow.currentVersion.id, status: "QUEUED", triggerType: "MANUAL",
      triggerPayload: samplePayload, idempotencyKey: `autopilot:${a.id}:${crypto.randomUUID()}`, correlationId: crypto.randomUUID(),
      requestedBy: req.admin?.email ?? "unknown", maxAttempts: 1,
    },
  });
  await enqueueExecutionRun(execution.id);
  await recordAudit(req.admin?.email ?? "unknown", "autopilot.run", "Autopilot", a.id, { executionId: execution.id });
  res.status(202).json({ executionId: execution.id });
});

/** A run in words: which steps ran and what each did. */
autopilotsRouter.get("/runs/:executionId", async (req, res) => {
  const execution = await prisma.engineExecution.findUnique({
    where: { id: String(req.params.executionId) },
    include: { workflow: { select: { name: true } }, steps: { orderBy: { startedAt: "asc" }, select: { stepKey: true, status: true, output: true, error: true } } },
  });
  if (!execution) return res.status(404).json({ message: "Run not found" });
  res.json({ id: execution.id, status: execution.status, name: execution.workflow.name, error: execution.error, steps: execution.steps });
});
