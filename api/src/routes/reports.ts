import { Router } from "express";
import { prisma } from "../lib/prisma";

export const reportsRouter = Router();

function rangeStart(period: string): Date {
  const now = new Date();
  if (period === "week") return new Date(now.getTime() - 7 * 86400000);
  if (period === "month") return new Date(now.getTime() - 30 * 86400000);
  return new Date(now.getTime() - 86400000); // "day"
}

reportsRouter.get("/", async (req, res) => {
  const period = (req.query.period as string) ?? "week";
  const since = rangeStart(period);

  const [executions, videoJobs, approvals] = await Promise.all([
    prisma.automationExecution.findMany({ where: { startedAt: { gte: since } } }),
    prisma.videoJob.findMany({ where: { createdAt: { gte: since } } }),
    prisma.approval.findMany({ where: { createdAt: { gte: since } } }),
  ]);

  const successes = executions.filter((e) => e.status === "SUCCESS").length;
  const failures = executions.filter((e) => e.status === "FAILED").length;

  res.json({
    period,
    since,
    totalExecutions: executions.length,
    successfulExecutions: successes,
    failedExecutions: failures,
    successRate: executions.length ? Math.round((successes / executions.length) * 100) : null,
    videosGenerated: videoJobs.filter((j) => j.state === "READY").length,
    videosFailed: videoJobs.filter((j) => j.state === "FAILED").length,
    approvalsPending: approvals.filter((a) => a.status === "PENDING").length,
    approvalsApproved: approvals.filter((a) => a.status === "APPROVED").length,
    approvalsRejected: approvals.filter((a) => a.status === "REJECTED").length,
  });
});
