import { Router } from "express";
import { prisma } from "../lib/prisma";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { schedulerStatus } from "../modules/system/scheduler";

export const workflowsRouter = Router();

function blockers(detail: unknown): string[] {
  return ((detail as { ok: boolean; label: string; note?: string }[]) ?? []).filter((d) => !d.ok).map((d) => d.note ?? `${d.label} not satisfied`);
}

workflowsRouter.get("/", async (_req, res) => res.json(await prisma.workflowConfig.findMany({ orderBy: { key: "asc" } })));

workflowsRouter.get("/n8n-status", async (_req, res) => {
  const workflows = await prisma.workflowConfig.findMany({ select: { enabled: true, readiness: true } });
  res.json({ health: { status: "ONLINE", message: "Native TypeScript automation engine", checkedAt: new Date().toISOString() }, scheduler: schedulerStatus(), native: { total: workflows.length, enabled: workflows.filter((w) => w.enabled).length } });
});

workflowsRouter.post("/sync", async (_req, res) => { await recomputeAllReadiness(); res.json({ ok: true, native: true }); });

workflowsRouter.post("/:key/enable", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  await recomputeAllReadiness();
  const wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return res.status(404).json({ message: "Unknown workflow" });
  const reasons = blockers(wf.readinessDetail);
  if (wf.readiness !== "READY") return res.status(409).json({ message: reasons.join("; ") || wf.readiness });
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: true, n8nActive: true, n8nPresent: true } });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.enabled", "WorkflowConfig", key, { engine: "native" });
  res.json({ ok: true, engine: "native" });
});

workflowsRouter.post("/:key/disable", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const wf = await prisma.workflowConfig.findUnique({ where: { key } });
  if (!wf) return res.status(404).json({ message: "Unknown workflow" });
  await prisma.workflowConfig.update({ where: { key }, data: { enabled: false, n8nActive: false } });
  await recordAudit(req.admin?.email ?? "unknown", "workflow.disabled", "WorkflowConfig", key, { engine: "native" });
  res.json({ ok: true, engine: "native" });
});

workflowsRouter.post("/:key/test-run", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  if (!(await prisma.workflowConfig.findUnique({ where: { key } }))) return res.status(404).json({ message: "Unknown workflow" });
  res.status(501).json({ ok: false, kind: "not-implemented", message: "Native workflow test fixtures are not defined for this workflow yet" });
});

workflowsRouter.post("/activate-ready", async (req: AuthedRequest, res) => {
  await recomputeAllReadiness();
  const workflows = await prisma.workflowConfig.findMany({ orderBy: { key: "asc" } });
  const activated: string[] = []; const alreadyActive: string[] = []; const skipped: { key: string; name: string; reasons: string[] }[] = [];
  for (const wf of workflows) {
    if (wf.enabled) { alreadyActive.push(wf.key); continue; }
    if (wf.readiness !== "READY") { skipped.push({ key: wf.key, name: wf.name, reasons: blockers(wf.readinessDetail) }); continue; }
    await prisma.workflowConfig.update({ where: { key: wf.key }, data: { enabled: true, n8nActive: true, n8nPresent: true } }); activated.push(wf.key);
  }
  await recordAudit(req.admin?.email ?? "unknown", "automation.activate_ready", undefined, undefined, { activated, alreadyActive, skipped: skipped.map((s) => s.key), engine: "native" });
  res.json({ activated, alreadyActive, skipped, summary: { activated: activated.length, alreadyActive: alreadyActive.length, skipped: skipped.length } });
});

workflowsRouter.post("/deactivate-all", async (req: AuthedRequest, res) => {
  const result = await prisma.workflowConfig.updateMany({ where: { enabled: true }, data: { enabled: false, n8nActive: false } });
  await recordAudit(req.admin?.email ?? "unknown", "automation.deactivate_all", undefined, undefined, { count: result.count, engine: "native" });
  res.json({ ok: true, count: result.count, engine: "native" });
});
