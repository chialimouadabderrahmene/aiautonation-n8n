import { Router } from "express";
import { prisma } from "../lib/prisma";
import { enqueueWeeklyReportRun } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const reportsRouter = Router();

/** Manual run of the weekly Telegram digest (native port of n8n workflow 09/22's Manual Run node) — the worker's own Monday 09:00 UTC schedule covers the automatic path. */
reportsRouter.post("/weekly/run", async (req: AuthedRequest, res) => {
  await enqueueWeeklyReportRun();
  await recordAudit(req.admin?.email ?? "unknown", "reports.weekly_run_requested", "AutomationExecution", "weekly-report");
  res.status(202).json({ ok: true, message: "Queued — the worker sends the weekly digest to Telegram next" });
});

function rangeStart(period: string): Date {
  const days = period === "day" ? 1 : period === "month" ? 30 : 7;
  return new Date(Date.now() - days * 86400000);
}

reportsRouter.get("/", async (req, res) => {
  const period = ["day", "week", "month"].includes(String(req.query.period)) ? String(req.query.period) : "week";
  const since = rangeStart(period);

  const [executions, videoJobs, approvals, publications, workflows] = await Promise.all([
    prisma.automationExecution.findMany({ where: { startedAt: { gte: since } }, select: { status: true, source: true, workflowConfigId: true, durationMs: true, startedAt: true } }),
    prisma.videoJob.findMany({ where: { createdAt: { gte: since } }, select: { state: true, startedAt: true, completedAt: true, errorStage: true } }),
    prisma.approval.findMany({ where: { createdAt: { gte: since } }, select: { status: true } }),
    prisma.publication.findMany({ where: { createdAt: { gte: since } }, select: { status: true, target: true } }),
    prisma.workflowConfig.findMany({ select: { id: true, key: true, name: true } }),
  ]);

  const successes = executions.filter((e) => e.status === "SUCCESS").length;
  const failures = executions.filter((e) => e.status === "FAILED").length;
  const finished = executions.filter((e) => e.durationMs !== null);

  const perWorkflow = workflows
    .map((w) => {
      const runs = executions.filter((e) => e.workflowConfigId === w.id);
      return { key: w.key, name: w.name, runs: runs.length, success: runs.filter((r) => r.status === "SUCCESS").length, failed: runs.filter((r) => r.status === "FAILED").length };
    })
    .filter((w) => w.runs > 0)
    .sort((a, b) => b.runs - a.runs);

  const bySource = ["N8N", "VIDEO_WORKER", "CONTROL_CENTER"].map((source) => {
    const runs = executions.filter((e) => e.source === source);
    return { source, runs: runs.length, success: runs.filter((r) => r.status === "SUCCESS").length, failed: runs.filter((r) => r.status === "FAILED").length };
  });

  const days: { date: string; success: number; failed: number }[] = [];
  const dayCount = period === "day" ? 1 : period === "month" ? 30 : 7;
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const ofDay = executions.filter((e) => e.startedAt.toISOString().slice(0, 10) === d);
    days.push({ date: d, success: ofDay.filter((e) => e.status === "SUCCESS").length, failed: ofDay.filter((e) => e.status === "FAILED").length });
  }

  const readyVideos = videoJobs.filter((j) => j.state === "READY" && j.startedAt && j.completedAt);
  const failedStages: Record<string, number> = {};
  for (const j of videoJobs) if (j.state === "FAILED" && j.errorStage) failedStages[j.errorStage] = (failedStages[j.errorStage] ?? 0) + 1;

  res.json({
    period,
    since,
    totalExecutions: executions.length,
    successfulExecutions: successes,
    failedExecutions: failures,
    successRate: successes + failures ? Math.round((successes / (successes + failures)) * 100) : null,
    avgDurationMs: finished.length ? Math.round(finished.reduce((s, e) => s + (e.durationMs ?? 0), 0) / finished.length) : null,
    perWorkflow,
    bySource,
    daily: days,
    videosGenerated: videoJobs.filter((j) => j.state === "READY").length,
    videosFailed: videoJobs.filter((j) => j.state === "FAILED").length,
    videoFailedStages: failedStages,
    avgVideoGenerationSec: readyVideos.length
      ? Math.round(readyVideos.reduce((s, j) => s + (j.completedAt!.getTime() - j.startedAt!.getTime()), 0) / readyVideos.length / 1000)
      : null,
    approvalsPending: approvals.filter((a) => a.status === "PENDING").length,
    approvalsApproved: approvals.filter((a) => a.status === "APPROVED").length,
    approvalsRejected: approvals.filter((a) => a.status === "REJECTED").length,
    publicationsPublished: publications.filter((p) => p.status === "PUBLISHED").length,
    publicationsFailed: publications.filter((p) => p.status === "FAILED").length,
  });
});
