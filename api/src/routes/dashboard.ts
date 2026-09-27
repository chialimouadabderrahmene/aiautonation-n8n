import { Router } from "express";
import { prisma } from "../lib/prisma";
import { evaluateRequirements } from "../modules/workflows/readiness";
import { VIDEO_PIPELINE_REQUIREMENTS } from "./video";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res) => {
  const [integrations, workflows, todayExecutions, videoJobs] = await Promise.all([
    prisma.integration.findMany(),
    prisma.workflowConfig.findMany(),
    prisma.automationExecution.findMany({ where: { startedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.videoJob.findMany(),
  ]);

  // Reuse the n8n Integration row's own status (set by Integrations → Test
  // connection) rather than pinging n8n again here — one source of truth for
  // "is n8n connected", and it uses the NOT_CONFIGURED/TEST_FAILED/CONNECTED
  // vocabulary consistently instead of a second, narrower CONNECTED/BLOCKED
  // pair.
  const n8nIntegration = integrations.find((i) => i.provider === "n8n");
  const n8nStatus = n8nIntegration?.status ?? "NOT_CONFIGURED";

  const videoReadiness = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS);

  const actionRequired: { label: string; detail: string }[] = [];
  for (const i of integrations) {
    if (i.status === "TEST_FAILED") actionRequired.push({ label: i.provider, detail: i.lastTestMessage ?? "Connection test failed" });
    if (i.status === "ACTION_REQUIRED") actionRequired.push({ label: i.provider, detail: "Action required" });
  }
  for (const w of workflows) {
    if (w.readiness === "ACTION_REQUIRED") {
      const blockers = (w.readinessDetail as { ok: boolean; note?: string }[]).filter((d) => !d.ok).map((d) => d.note).join("; ");
      actionRequired.push({ label: w.name, detail: blockers || "Action required" });
    }
  }
  if (n8nStatus === "NOT_CONFIGURED") actionRequired.push({ label: "n8n", detail: "No instance configured — see docs/N8N_SETUP.md" });
  if (videoReadiness.readiness !== "READY") {
    const blockers = videoReadiness.detail.filter((d) => !d.ok).map((d) => d.note).join("; ");
    actionRequired.push({ label: "Video Generator", detail: blockers });
  }

  const anyConnected = integrations.some((i) => i.status === "CONNECTED");
  const allWorkflowsReady = workflows.length > 0 && workflows.every((w) => w.readiness === "READY");
  const overallSystem: "READY" | "PARTIALLY_READY" | "BLOCKED" =
    n8nStatus === "CONNECTED" && allWorkflowsReady
      ? "READY"
      : n8nStatus === "CONNECTED" || anyConnected
        ? "PARTIALLY_READY"
        : "BLOCKED";

  res.json({
    system: overallSystem,
    n8nStatus,
    integrations: {
      total: integrations.length,
      connected: integrations.filter((i) => i.status === "CONNECTED").length,
      actionRequired: integrations.filter((i) => i.status === "TEST_FAILED" || i.status === "ACTION_REQUIRED" || i.status === "NOT_CONFIGURED").length,
    },
    automations: {
      enabled: workflows.filter((w) => w.enabled).length,
      disabled: workflows.filter((w) => !w.enabled).length,
      ready: workflows.filter((w) => w.readiness === "READY").length,
      blocked: workflows.filter((w) => w.readiness === "BLOCKED").length,
    },
    video: {
      running: videoJobs.filter((j) => !["READY", "FAILED", "CANCELLED", "QUEUED"].includes(j.state)).length,
      completed: videoJobs.filter((j) => j.state === "READY").length,
      failed: videoJobs.filter((j) => j.state === "FAILED").length,
      readiness: videoReadiness.readiness,
    },
    today: {
      executions: todayExecutions.length,
      successful: todayExecutions.filter((e) => e.status === "SUCCESS").length,
      failed: todayExecutions.filter((e) => e.status === "FAILED").length,
    },
    actionRequired,
  });
});
