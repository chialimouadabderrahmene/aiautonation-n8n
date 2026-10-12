import { Router } from "express";
import { prisma } from "../lib/prisma";
import { n8nClient } from "../modules/n8n/client";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { recomputeAllReadiness, toEngineKey } from "../modules/workflows/readiness";
import { runN8nSync, schedulerStatus } from "../modules/system/scheduler";
import { testRunWorkflow } from "../modules/n8n/testRun";
import { checkN8n } from "../modules/system/health";
import { safeErrorMessage } from "../lib/http";

const BUILT_IN_ENGINE_KEYS = new Set(["global-error-handler", "content-approval"]);

/** Enables/disables the workflow's native engine row — this is the real runtime switch;
 * the engine executes it directly and never needs n8n running. n8n activation (when n8n
 * happens to be connected) is purely a best-effort mirror for operators who still use the
 * legacy n8n editor side-by-side — its failure or absence never blocks the real toggle. */
async function setEngineEnabled(key: string, enabled: boolean): Promise<{ ok: boolean; reason?: string }> {
  const engineKey = toEngineKey(key);
  if (BUILT_IN_ENGINE_KEYS.has(engineKey)) return { ok: true };
  const wf = await prisma.engineWorkflow.findUnique({ where: { key: engineKey }, select: { currentVersionId: true } });
  if (!wf) return { ok: false, reason: "No native engine workflow found for this key" };
  if (enabled && !wf.currentVersionId) return { ok: false, reason: "No published version exists for this workflow yet" };
  await prisma.engineWorkflow.update({ where: { key: engineKey }, data: { enabled } });
  return { ok: true };
}

export const workflowsRouter = Router();

interface Detail {
  ok: boolean;
  label: string;
  note?: string;
}

function blockers(detail: unknown): string[] {
  return ((detail as Detail[]) ?? []).filter((d) => !d.ok).map((d) => d.note ?? `${d.label} not satisfied`);
}

workflowsRouter.get("/", async (_req, res) => {
  const workflows = await prisma.workflowConfig.findMany({ orderBy: { key: "asc" } });
  res.json(workflows);
});

workflowsRouter.get("/n8n-status", async (_req, res) => {
  const [health, report] = await Promise.all([checkN8n(), prisma.setting.findUnique({ where: { key: "_n8nLastReconcile" } })]);
  res.json({ health, lastReconcile: report?.value ?? null, scheduler: schedulerStatus() });
});

/** Re-import/re-sync now (idempotent). Normally runs automatically. */
workflowsRouter.post("/sync", async (req: AuthedRequest, res) => {
  try {
    const report = await runN8nSync(req.admin?.email ?? "unknown");
    res.json(report);
  } catch (err) {
    res.status(502).json({ message: safeErrorMessage(err) });
  }
});

async function enableOne(key: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return { ok: false, reason: "Unknown workflow" };
  if (wf.readiness !== "READY") return { ok: false, reason: blockers(wf.readinessDetail).join("; ") || wf.readiness };
  // Real toggle: the native engine, which never needs n8n to execute.
  const engineResult = await setEngineEnabled(key, true);
  if (!engineResult.ok) return { ok: false, reason: engineResult.reason ?? "Could not enable the native workflow" };
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: true } });
  // Best-effort mirror into n8n for operators who still have it connected side-by-side.
  // Its absence or failure never blocks the real (native) enable above.
  if (wf.n8nWorkflowId) {
    try {
      const result = await n8nClient.activate(wf.n8nWorkflowId);
      await prisma.workflowConfig.update({ where: { key }, data: { n8nActive: result.active } });
    } catch {
      // n8n is optional infrastructure now — ignore.
    }
  }
  return { ok: true };
}

workflowsRouter.post("/:key/enable", async (req: AuthedRequest, res) => {
  await recomputeAllReadiness();
  const result = await enableOne(String(req.params.key));
  if (!result.ok) return res.status(409).json({ message: result.reason });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.enabled", "WorkflowConfig", String(req.params.key));
  res.json({ ok: true });
});

workflowsRouter.post("/:key/disable", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return res.status(404).json({ message: "Unknown workflow" });
  // Real toggle: the native engine stops matching triggers for this workflow immediately.
  await setEngineEnabled(key, false);
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: false } });
  // Best-effort mirror into n8n; its unreachability never blocks the real (native) disable above.
  if (wf.n8nWorkflowId) {
    try {
      await n8nClient.deactivate(wf.n8nWorkflowId);
      await prisma.workflowConfig.update({ where: { key }, data: { n8nActive: false } });
    } catch (err) {
      await recordAudit(req.admin?.email ?? "unknown", "workflow.disabled", "WorkflowConfig", key, { n8nError: safeErrorMessage(err) });
      return res.json({ ok: true, message: `Disabled. (n8n mirror unreachable: ${safeErrorMessage(err)} — harmless, n8n is optional.)` });
    }
  }
  await recordAudit(req.admin?.email ?? "unknown", "workflow.disabled", "WorkflowConfig", key);
  res.json({ ok: true });
});

workflowsRouter.post("/:key/test-run", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return res.status(404).json({ message: "Unknown workflow" });
  try {
    const result = await testRunWorkflow(key, req.admin?.email ?? "unknown");
    await recordAudit(req.admin?.email ?? "unknown", "workflow.test_run", "WorkflowConfig", key, { ok: result.ok, kind: result.kind, message: result.message });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, message: safeErrorMessage(err) });
  }
});

/** ACTIVATE READY AUTOMATIONS: recalculates readiness first, enables only
 * READY workflows, reports each skipped one with its exact reasons. */
workflowsRouter.post("/activate-ready", async (req: AuthedRequest, res) => {
  await recomputeAllReadiness();
  const workflows = await prisma.workflowConfig.findMany({ orderBy: { key: "asc" } });
  const activated: string[] = [];
  const alreadyActive: string[] = [];
  const skipped: { key: string; name: string; reasons: string[] }[] = [];

  for (const wf of workflows) {
    if (wf.enabled) {
      alreadyActive.push(wf.key);
      continue;
    }
    const result = await enableOne(wf.key);
    if (result.ok) activated.push(wf.key);
    else skipped.push({ key: wf.key, name: wf.name, reasons: wf.readiness === "READY" ? [result.reason] : blockers(wf.readinessDetail) });
  }

  await recordAudit(req.admin?.email ?? "unknown", "automation.activate_ready", undefined, undefined, { activated, alreadyActive, skipped: skipped.map((s) => s.key) });
  res.json({ activated, alreadyActive, skipped, summary: { activated: activated.length, alreadyActive: alreadyActive.length, skipped: skipped.length } });
});

workflowsRouter.post("/deactivate-all", async (req: AuthedRequest, res) => {
  const workflows = await prisma.workflowConfig.findMany({ where: { OR: [{ enabled: true }, { n8nActive: true }] } });
  const failed: string[] = [];
  for (const wf of workflows) {
    await setEngineEnabled(wf.key, false);
    await prisma.workflowConfig.update({ where: { key: wf.key }, data: { enabled: false } });
    if (wf.n8nWorkflowId) {
      try {
        await n8nClient.deactivate(wf.n8nWorkflowId);
        await prisma.workflowConfig.update({ where: { key: wf.key }, data: { n8nActive: false } });
      } catch {
        failed.push(wf.key);
      }
    }
  }
  await recordAudit(req.admin?.email ?? "unknown", "automation.deactivate_all", undefined, undefined, { count: workflows.length, failed });
  res.json({ ok: true, count: workflows.length, pendingInN8n: failed });
});
