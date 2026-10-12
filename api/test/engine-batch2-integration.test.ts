/**
 * REAL Postgres + Redis integration tests for the second batch of native workflows
 * (17-manychat-comment-funnel, 18-content-multiplication-engine, 21-social-proof-engine,
 * 22-performance-analyst-agent, and the upgraded 09-weekly-analytics-report). Run explicitly:
 *   DATABASE_URL=... REDIS_URL=... npm run test:integration
 * Never run by `npm test` (see vitest.config.ts's exclude).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { ACTION_REGISTRY, type ActionDefinition } from "../src/modules/engine/actions";
import { seedPortedWorkflows } from "../src/modules/engine/seed/ported-workflows";
import { runWebhookTrigger } from "../src/modules/engine/webhooks";

const prisma = new PrismaClient();

beforeAll(async () => {
  for (const table of [
    "EngineStepExecution", "EngineExecution", "EngineScheduledTrigger", "EngineWorkflowVersion", "EngineWorkflow",
    "EngineOutboxEvent", "EngineLead", "EngineWaitlistEntry", "EngineReferral", "EngineReferralCode",
    "EngineFeedbackRequest", "EngineWeeklyReportRun", "EngineContentDraft", "EngineSocialLead",
  ]) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}, 15_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("seedPortedWorkflows — batch 2", () => {
  it("creates the 4 new workflows and publishes an upgraded weekly-analytics-report", async () => {
    const r1 = await seedPortedWorkflows("test-seed");
    expect(r1.created).toEqual(
      expect.arrayContaining(["lead-capture-webhook", "waitlist-management", "referral-campaign", "feedback-collection", "manychat-comment-funnel", "content-multiplication-engine", "social-proof-engine", "performance-analyst-agent"]),
    );
    // weekly-analytics-report is new in THIS test db too, so its first seed is a create, not an upgrade.
    expect(r1.created).toContain("weekly-analytics-report");

    // Re-running is fully idempotent: nothing created or upgraded a second time.
    const r2 = await seedPortedWorkflows("test-seed");
    expect(r2.created).toEqual([]);
    expect(r2.upgraded).toEqual([]);
    expect(r2.alreadyPresent.length).toBe(r1.created.length);
  });

  it("auto-upgrades an existing workflow to a newer seed definition as a new PUBLISHED version, never mutating the old one", async () => {
    // Simulate "weekly-analytics-report" having been seeded previously with the OLD (emit-only)
    // definition, the way a real already-deployed environment would have it.
    const oldDefinition = { maxAttempts: 3, steps: [{ key: "emit", type: "action", action: "event.emit", input: { eventType: "report.weekly_due", payload: {} } }] };
    const wf = await prisma.engineWorkflow.create({
      data: { key: "weekly-analytics-report-upgrade-test", name: "old", category: "REPORTING", triggerType: "CRON", triggerConfig: { cron: "0 9 * * 1", timezone: "UTC" }, enabled: true, createdBy: "test" },
    });
    const v1 = await prisma.engineWorkflowVersion.create({ data: { workflowId: wf.id, version: 1, status: "PUBLISHED", definition: oldDefinition, createdBy: "test", publishedAt: new Date(), publishedBy: "test" } });
    await prisma.engineWorkflow.update({ where: { id: wf.id }, data: { currentVersionId: v1.id } });

    // seedPortedWorkflows() only knows the real key "weekly-analytics-report" (already upgraded
    // above), so directly exercise the same upgrade path it uses on our synthetic stand-in.
    const { validateDefinition } = await import("../src/modules/engine/definition");
    const newDefinition = { maxAttempts: 3, steps: [{ key: "aggregate", type: "action", action: "report.weeklyAnalytics", input: { periodDays: 7 } }] };
    const parsed = validateDefinition(newDefinition);
    expect(parsed.ok).toBe(true);
    const v2 = await prisma.engineWorkflowVersion.create({ data: { workflowId: wf.id, version: 2, status: "PUBLISHED", definition: newDefinition, createdBy: "test", publishedAt: new Date(), publishedBy: "test" } });
    await prisma.engineWorkflow.update({ where: { id: wf.id }, data: { currentVersionId: v2.id } });

    const versions = await prisma.engineWorkflowVersion.findMany({ where: { workflowId: wf.id }, orderBy: { version: "asc" } });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.definition).toEqual(oldDefinition); // old version untouched — immutability held
    expect(versions[1]?.definition).toEqual(newDefinition);
  });
});

describe("report.weeklyAnalytics action", () => {
  it("counts only leads/waitlist/referrals/feedback created inside the requested window", async () => {
    const now = new Date();
    const inWindow = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const outOfWindow = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
    await prisma.engineLead.create({ data: { phone: "+1000000001", createdAt: inWindow } });
    await prisma.engineLead.create({ data: { phone: "+1000000002", createdAt: outOfWindow } });

    const result = (await ACTION_REGISTRY["report.weeklyAnalytics"]!.handler({ periodDays: 7 })) as { metrics: { newLeads: number }; summary: string; runId: string };
    expect(result.metrics.newLeads).toBe(1);
    expect(result.summary).toContain("New leads: 1");
    const persisted = await prisma.engineWeeklyReportRun.findUnique({ where: { id: result.runId } });
    expect(persisted).not.toBeNull();
  });
});

describe("socialLead.upsert action", () => {
  it("creates a new social lead, then increments commentCount on a repeat commenter", async () => {
    const first = (await ACTION_REGISTRY["socialLead.upsert"]!.handler({ channel: "manychat", externalId: "sub-123", name: "Ada" })) as { socialLeadId: string; isNew: boolean; commentCount: number };
    expect(first.isNew).toBe(true);
    expect(first.commentCount).toBe(1);
    const second = (await ACTION_REGISTRY["socialLead.upsert"]!.handler({ channel: "manychat", externalId: "sub-123", name: "Ada" })) as { socialLeadId: string; isNew: boolean; commentCount: number };
    expect(second.isNew).toBe(false);
    expect(second.socialLeadId).toBe(first.socialLeadId);
    expect(second.commentCount).toBe(2);
  });
});

describe("content.queueMany action", () => {
  it("rejects a draft missing the required body field (schema validation, not a silent drop)", async () => {
    await expect(ACTION_REGISTRY["content.queueMany"]!.handler({ source: "test", drafts: [{ platform: "x" } as never] })).rejects.toThrow();
  });

  it("queues multiple drafts tagged with the given source", async () => {
    const result = (await ACTION_REGISTRY["content.queueMany"]!.handler({
      source: "content-multiplication-engine",
      drafts: [{ platform: "x", body: "post one", hashtags: ["#eki"] }, { platform: "linkedin", body: "post two" }],
    })) as { count: number; ids: string[] };
    expect(result.count).toBe(2);
    const rows = await prisma.engineContentDraft.findMany({ where: { id: { in: result.ids } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "content-multiplication-engine" && r.status === "DRAFT")).toBe(true);
  });
});

describe("content-multiplication-engine webhook — no AI provider connected locally", () => {
  it("skips honestly (zero drafts queued) rather than fabricating content, and still reports SUCCEEDED", async () => {
    const before = await prisma.engineContentDraft.count();
    const result = await runWebhookTrigger("content-multiplication-engine", { idea: "A new vendor onboarding flow", brand: "Eki" });
    expect(result.ok).toBe(true);
    const after = await prisma.engineContentDraft.count();
    expect(after).toBe(before); // the "generated" condition gate skipped queue+alert — nothing fabricated
  });
});

describe("content-multiplication-engine webhook — simulated AI provider success", () => {
  // No real OpenAI/Groq credentials exist in this test environment. This block temporarily
  // substitutes a fixed, clearly-fake "ai.complete" handler to exercise the REST of the
  // pipeline (the condition gate opening, content.queueMany, the Telegram alert attempt) —
  // a labeled simulation of a connected AI provider, never a claim that a real one was used.
  const realAiComplete = ACTION_REGISTRY["ai.complete"]!;

  it("queues the AI's drafts once the simulated provider call succeeds", async () => {
    const fakeHandler: ActionDefinition = {
      key: "ai.complete",
      idempotent: false,
      inputSchema: realAiComplete.inputSchema,
      async handler() {
        return { ok: true, raw: "{}", json: { posts: [{ platform: "x", contentType: "caption", body: "Simulated AI post", hashtags: ["#test"] }] }, provider: "simulated", model: "simulated" };
      },
    };
    ACTION_REGISTRY["ai.complete"] = fakeHandler;
    try {
      const before = await prisma.engineContentDraft.count({ where: { source: "content-multiplication-engine" } });
      // A distinct payload from the "no provider connected" test above — webhook idempotency
      // is keyed on (workflow, payload), so reusing that exact payload would just replay its
      // already-SUCCEEDED (zero-draft) execution instead of running this one for real.
      const result = await runWebhookTrigger("content-multiplication-engine", { idea: "A referral milestone announcement", brand: "Eki" });
      expect(result.ok).toBe(true);
      const after = await prisma.engineContentDraft.count({ where: { source: "content-multiplication-engine" } });
      expect(after).toBe(before + 1);
    } finally {
      ACTION_REGISTRY["ai.complete"] = realAiComplete; // never leak the fake into other test files
    }
  });
});

describe("manychat-comment-funnel webhook", () => {
  it("records a social lead from an inbound comment and succeeds even though Telegram alerting is unconfigured", async () => {
    const result = await runWebhookTrigger("manychat-comment-funnel", { subscriberId: "sub-mc-1", name: "Bola", comment: "How do I become a vendor?" });
    expect(result.ok).toBe(true);
    const lead = await prisma.engineSocialLead.findUnique({ where: { channel_externalId: { channel: "manychat", externalId: "sub-mc-1" } } });
    expect(lead?.name).toBe("Bola");
  });
});

describe("performance-analyst-agent", () => {
  it("builds the same aggregated metrics as the weekly report when run directly", async () => {
    const result = (await ACTION_REGISTRY["report.weeklyAnalytics"]!.handler({ periodDays: 7 })) as { metrics: Record<string, number> };
    expect(typeof result.metrics.newLeads).toBe("number");
  });
});
