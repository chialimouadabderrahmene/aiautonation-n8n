import { Router } from "express";
import { prisma } from "../lib/prisma";
import { n8nClient } from "../modules/n8n/client";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { runN8nSync, schedulerStatus } from "../modules/system/scheduler";
import { testRunWorkflow } from "../modules/n8n/testRun";
import { checkN8n } from "../modules/system/health";
import { safeErrorMessage } from "../lib/http";

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
  let wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return { ok: false, reason: "Unknown workflow" };
  if (!wf.n8nPresent) {
    // Right after a restart the first sync may not have run yet: run it now
    // instead of refusing (it is idempotent and never activates anything).
    await runN8nSync().catch(() => undefined);
    wf = (await prisma.workflowConfig.findUnique({ where: { key } }))!;
  }
  if (wf.readiness !== "READY") return { ok: false, reason: blockers(wf.readinessDetail).join("; ") || wf.readiness };
  if (!wf.n8nWorkflowId) return { ok: false, reason: "Not imported into n8n" };
  try {
    const result = await n8nClient.activate(wf.n8nWorkflowId);
    if (!result.active) return { ok: false, reason: "n8n did not report the workflow as active" };
  } catch (err) {
    return { ok: false, reason: `n8n refused activation: ${safeErrorMessage(err)}` };
  }
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: true, n8nActive: true } });
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
  // Mark disabled first: even if n8n is briefly unreachable, the reconcile
  // loop will deactivate it (drift) as soon as it can.
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: false } });
  if (wf.n8nWorkflowId) {
    try {
      await n8nClient.deactivate(wf.n8nWorkflowId);
      await prisma.workflowConfig.update({ where: { key }, data: { n8nActive: false } });
    } catch (err) {
      await recordAudit(req.admin?.email ?? "unknown", "workflow.disabled", "WorkflowConfig", key, { n8nError: safeErrorMessage(err) });
      return res.status(202).json({ ok: true, message: `Disabled here; n8n was unreachable (${safeErrorMessage(err)}) — it will be deactivated automatically when n8n answers.` });
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
    if (wf.enabled && wf.n8nActive) {
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
