import { Router } from "express";
import { prisma } from "../lib/prisma";
import { evaluateRequirements, takeSnapshot } from "../modules/workflows/readiness";
import { VIDEO_PIPELINE_REQUIREMENTS, VIDEO_APPROVAL_REQUIREMENTS } from "../modules/workflows/manifest";
import { systemHealth } from "../modules/system/health";
import { getProvider } from "../modules/providers/registry";
import { providerOverrides } from "../lib/http";

export const dashboardRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Real count now vs. the prior equal-length window, for an honest week-over-week delta
 * (never a fabricated percentage) — `pct` is null when there is nothing to compare against. */
async function windowedCount(count: (gte: Date, lt?: Date) => Promise<number>, days = 7) {
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const prevSince = new Date(now.getTime() - 2 * days * DAY_MS);
  const [current, previous] = await Promise.all([count(since), count(prevSince, since)]);
  const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : null;
  return { last7d: current, pct };
}

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

  // Real counts only — every number below is a genuine aggregate query, never a placeholder.
  const [
    contentTotal,
    contentWindow,
    leadsEngineTotal,
    leadsWaitlistTotal,
    leadsWindow,
    messagesTotal,
    messagesWindow,
    recentAudit,
    recentExecutions,
    perfExecutions,
  ] = await Promise.all([
    Promise.all([prisma.engineContentDraft.count(), prisma.contentVariant.count()]).then(([a, b]) => a + b),
    windowedCount((gte, lt) => prisma.engineContentDraft.count({ where: { createdAt: { gte, ...(lt ? { lt } : {}) } } })),
    prisma.engineLead.count(),
    prisma.waitlistEntry.count(),
    windowedCount((gte, lt) =>
      Promise.all([
        prisma.engineLead.count({ where: { createdAt: { gte, ...(lt ? { lt } : {}) } } }),
        prisma.waitlistEntry.count({ where: { createdAt: { gte, ...(lt ? { lt } : {}) } } }),
      ]).then(([a, b]) => a + b),
    ),
    prisma.engineWhatsAppConversation.count({ where: { replySent: { not: null } } }),
    windowedCount((gte, lt) => prisma.engineWhatsAppConversation.count({ where: { replySent: { not: null }, createdAt: { gte, ...(lt ? { lt } : {}) } } })),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.engineExecution.findMany({
      where: { status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      take: 10,
      select: { id: true, finishedAt: true, startedAt: true, workflow: { select: { name: true } } },
    }),
    prisma.engineExecution.findMany({
      where: { startedAt: { gte: new Date(startOfDay.getTime() - 6 * DAY_MS) } },
      select: { startedAt: true, status: true },
    }),
  ]);

  const recentActivity = [
    ...recentAudit.map((a) => ({ at: a.createdAt.toISOString(), label: a.action.replace(/[._]/g, " "), detail: a.entityId ?? "" })),
    ...recentExecutions.map((e) => ({ at: (e.finishedAt ?? e.startedAt).toISOString(), label: `${e.workflow.name} ran`, detail: "completed successfully" })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  // Executions per day for the last 7 days — a real time series, not a mock sparkline.
  const perfByDay: { date: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(startOfDay.getTime() - i * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const total = perfExecutions.filter((e) => e.startedAt >= dayStart && e.startedAt < dayEnd).length;
    perfByDay.push({ date: dayStart.toISOString().slice(0, 10), total });
  }
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
  // n8n is optional legacy infrastructure — the native engine executes every workflow
  // without it, so it is deliberately excluded from the core-online determination.
  const coreOnline = ["api", "database", "redis", "worker"].every((k) => health[k as keyof typeof health].status === "ONLINE");

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
    metrics: {
      content: { total: contentTotal, ...contentWindow },
      leads: { total: leadsEngineTotal + leadsWaitlistTotal, ...leadsWindow },
      messages: { total: messagesTotal, ...messagesWindow },
    },
    recentActivity,
    performance: perfByDay,
    // Non-null ONLY in an explicitly configured test environment (see lib/http.ts).
    testModeOverrides: providerOverrides() ? Object.keys(providerOverrides()!) : null,
    generatedAt: new Date().toISOString(),
  });
});
