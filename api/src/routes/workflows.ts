import { Router } from "express";
import { prisma } from "../lib/prisma";
import { n8nClient, N8nNotConfiguredError } from "../modules/workflows/n8nClient";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const workflowsRouter = Router();

workflowsRouter.get("/", async (_req, res) => {
  const workflows = await prisma.workflowConfig.findMany({ orderBy: { key: "asc" } });
  res.json(workflows);
});

/** Live n8n status merged in where an instance is configured; workflows this
 * control center hasn't imported into n8n yet (n8nWorkflowId is null) are
 * reported as such rather than silently omitted. */
workflowsRouter.get("/n8n-status", async (_req, res) => {
  try {
    const reachable = await n8nClient.isReachable();
    if (!reachable) return res.json({ connected: false, workflows: [] });
    const { data } = await n8nClient.listWorkflows();
    res.json({ connected: true, workflows: data });
  } catch (err) {
    if (err instanceof N8nNotConfiguredError) return res.json({ connected: false, workflows: [] });
    res.status(502).json({ connected: false, message: err instanceof Error ? err.message : "n8n error" });
  }
});

/** Called by scripts/import-n8n-workflows.js after it creates a workflow in
 * a real n8n instance, so Automations knows which WorkflowConfig row maps to
 * which n8n workflow id (enable/disable/activate-ready all need this). */
workflowsRouter.post("/:key/link-n8n", async (req: AuthedRequest, res) => {
  const { n8nWorkflowId } = req.body as { n8nWorkflowId?: string };
  if (!n8nWorkflowId) return res.status(400).json({ message: "n8nWorkflowId is required" });
  const workflow = await prisma.workflowConfig.findUnique({ where: { key: req.params.key } });
  if (!workflow) return res.status(404).json({ message: "Unknown workflow" });

  await prisma.workflowConfig.update({ where: { key: req.params.key }, data: { n8nWorkflowId } });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.linked_n8n", "WorkflowConfig", req.params.key, { n8nWorkflowId });
  res.json({ ok: true });
});

workflowsRouter.post("/:key/enable", async (req: AuthedRequest, res) => {
  const workflow = await prisma.workflowConfig.findUnique({ where: { key: req.params.key } });
  if (!workflow) return res.status(404).json({ message: "Unknown workflow" });
  if (workflow.readiness !== "READY") {
    return res.status(409).json({ message: "Workflow is not READY — resolve its blockers first.", readiness: workflow.readiness, detail: workflow.readinessDetail });
  }
  if (workflow.n8nWorkflowId) {
    try {
      await n8nClient.activate(workflow.n8nWorkflowId);
    } catch (err) {
      return res.status(502).json({ message: err instanceof Error ? err.message : "Failed to activate in n8n" });
    }
  }
  await prisma.workflowConfig.update({ where: { key: req.params.key }, data: { enabled: true } });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.enabled", "WorkflowConfig", req.params.key);
  res.json({ ok: true });
});

workflowsRouter.post("/:key/disable", async (req: AuthedRequest, res) => {
  const workflow = await prisma.workflowConfig.findUnique({ where: { key: req.params.key } });
  if (!workflow) return res.status(404).json({ message: "Unknown workflow" });
  if (workflow.n8nWorkflowId) {
    try {
      await n8nClient.deactivate(workflow.n8nWorkflowId);
    } catch (err) {
      return res.status(502).json({ message: err instanceof Error ? err.message : "Failed to deactivate in n8n" });
    }
  }
  await prisma.workflowConfig.update({ where: { key: req.params.key }, data: { enabled: false } });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.disabled", "WorkflowConfig", req.params.key);
  res.json({ ok: true });
});

/** "Activate Automation": enables every workflow that is currently READY,
 * skips the rest, and reports exactly why each skipped one was skipped. */
workflowsRouter.post("/activate-ready", async (req: AuthedRequest, res) => {
  const workflows = await prisma.workflowConfig.findMany();
  const activated: string[] = [];
  const skipped: { key: string; reason: string }[] = [];

  for (const workflow of workflows) {
    if (workflow.readiness !== "READY") {
      skipped.push({ key: workflow.key, reason: `${workflow.readiness}` });
      continue;
    }
    if (workflow.n8nWorkflowId) {
      try {
        await n8nClient.activate(workflow.n8nWorkflowId);
      } catch (err) {
        skipped.push({ key: workflow.key, reason: err instanceof Error ? err.message : "n8n activation failed" });
        continue;
      }
    }
    await prisma.workflowConfig.update({ where: { key: workflow.key }, data: { enabled: true } });
    activated.push(workflow.key);
  }

  await recordAudit(req.admin?.email ?? "unknown", "automation.activate_ready", undefined, undefined, { activated, skipped });
  res.json({ activated, skipped });
});

workflowsRouter.post("/deactivate-all", async (req: AuthedRequest, res) => {
  const workflows = await prisma.workflowConfig.findMany({ where: { enabled: true } });
  for (const workflow of workflows) {
    if (workflow.n8nWorkflowId) {
      await n8nClient.deactivate(workflow.n8nWorkflowId).catch(() => undefined);
    }
    await prisma.workflowConfig.update({ where: { key: workflow.key }, data: { enabled: false } });
  }
  await recordAudit(req.admin?.email ?? "unknown", "automation.deactivate_all");
  res.json({ ok: true, count: workflows.length });
});
