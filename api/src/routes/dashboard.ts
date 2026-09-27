import { Router } from "express";
import { prisma } from "../lib/prisma";
import { evaluateRequirements, takeSnapshot } from "../modules/workflows/readiness";
import { VIDEO_PIPELINE_REQUIREMENTS, VIDEO_APPROVAL_REQUIREMENTS } from "../modules/workflows/manifest";
import { systemHealth } from "../modules/system/health";
import { getProvider } from "../modules/providers/registry";
import { providerOverrides } from "../lib/http";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res) => {
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
  const [integrations, workflows, todayExecutions, videoJobs, health, pendingApprovals] = await Promise.all([
    prisma.integration.findMany(),
    prisma.workflowConfig.findMany({ orderBy: { key: "asc" } }),
    prisma.automationExecution.findMany({ where: { startedAt: { gte: startOfDay } } }),
    prisma.videoJob.groupBy({ by: ["state"], _count: true }),
    systemHealth(),
    prisma.approval.count({ where: { status: "PENDING" } }),
  ]);
  const snap = await takeSnapshot({ includeInfra: true });
  const video = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS, snap);
  const approval = await evaluateRequirements(VIDEO_APPROVAL_REQUIREMENTS, snap);

  const actionRequired: { label: string; detail: string; link: string }[] = [];
  for (const [name, h] of Object.entries(health)) {
    if (h.status === "OFFLINE" || (h.status === "NOT_CONFIGURED" && name !== "n8n")) actionRequired.push({ label: `System: ${name}`, detail: h.message, link: "/dashboard" });
  }
  for (const i of integrations) {
    if (i.status === "TEST_FAILED" || i.status === "ACTION_REQUIRED") {
      actionRequired.push({ label: getProvider(i.provider)?.label ?? i.provider, detail: i.lastTestMessage ?? "Needs attention", link: "/integrations" });
    } else if (i.status === "CONFIGURED") {
      actionRequired.push({ label: getProvider(i.provider)?.label ?? i.provider, detail: "Saved but not tested — click Test connection", link: "/integrations" });
    }
  }
  if (video.readiness !== "READY") {
    actionRequired.push({ label: "Video Automation", detail: video.detail.filter((d) => !d.ok).map((d) => d.note).join("; "), link: "/video" });
  }

  const byState = Object.fromEntries(videoJobs.map((g) => [g.state, g._count]));
  const running = ["QUEUED", "SCRIPT_GENERATING", "STORYBOARD_READY", "VOICE_GENERATING", "VISUAL_GENERATING", "ASSEMBLING", "QUALITY_CHECK"].reduce((n, s) => n + (byState[s] ?? 0), 0);
  const ready = workflows.filter((w) => w.readiness === "READY").length;
  const coreOnline = ["api", "database", "redis", "worker", "n8n"].every((k) => health[k as keyof typeof health].status === "ONLINE");

  res.json({
    system: coreOnline && ready === workflows.length && video.readiness === "READY" ? "READY" : coreOnline ? "PARTIALLY_READY" : "BLOCKED",
    health,
    n8nStatus: integrations.find((i) => i.provider === "n8n")?.status ?? "NOT_CONFIGURED",
    integrations: {
      total: integrations.length,
      connected: integrations.filter((i) => i.status === "CONNECTED").length,
      notConfigured: integrations.filter((i) => i.status === "NOT_CONFIGURED").length,
      actionRequired: integrations.filter((i) => ["TEST_FAILED", "ACTION_REQUIRED", "CONFIGURED"].includes(i.status)).length,
      list: integrations.map((i) => ({ provider: i.provider, label: getProvider(i.provider)?.label ?? i.provider, status: i.status, lastTestedAt: i.lastTestedAt })),
    },
    automations: {
      total: workflows.length,
      enabled: workflows.filter((w) => w.enabled).length,
      activeInN8n: workflows.filter((w) => w.n8nActive).length,
      presentInN8n: workflows.filter((w) => w.n8nPresent).length,
      ready,
      blocked: workflows.filter((w) => w.readiness === "BLOCKED").length,
      actionRequired: workflows.filter((w) => w.readiness === "ACTION_REQUIRED").length,
      readyNotEnabled: workflows.filter((w) => w.readiness === "READY" && !w.enabled).length,
    },
    video: {
      readiness: video.readiness,
      detail: video.detail,
      approvalReadiness: approval.readiness,
      approvalDetail: approval.detail,
      running,
      completed: byState.READY ?? 0,
      failed: byState.FAILED ?? 0,
      pendingApprovals,
    },
    today: {
      executions: todayExecutions.length,
      successful: todayExecutions.filter((e) => e.status === "SUCCESS").length,
      failed: todayExecutions.filter((e) => e.status === "FAILED").length,
      running: todayExecutions.filter((e) => e.status === "RUNNING").length,
    },
    actionRequired,
    // Non-null ONLY in an explicitly configured test environment (see lib/http.ts).
    testModeOverrides: providerOverrides() ? Object.keys(providerOverrides()!) : null,
    generatedAt: new Date().toISOString(),
  });
});
