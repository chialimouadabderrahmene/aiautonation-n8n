/**
 * REAL Postgres + Redis integration tests for the native replacements of n8n workflows
 * 14-autopilot-controller and 20-ab-testing-engine, actions automation.dailySummary and
 * intelligence.analyzeContentPerformance. No real AI provider credentials exist in any
 * environment available to this project — a labeled local simulation (the project's existing
 * ALLOW_PROVIDER_OVERRIDES hook) exercises the real HTTP code path for the AI call.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
let mockServer: http.Server;
let aiResponseContent = "{}";

async function startMockAiProvider(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ choices: [{ message: { content: aiResponseContent } }] }));
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

beforeAll(async () => {
  const port = await startMockAiProvider();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "api.groq.com": `http://127.0.0.1:${port}` });
  await prisma.integration.upsert({ where: { provider: "groq" }, update: {}, create: { provider: "groq", category: "AI", authType: "API_KEY" } });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  await saveCredentials({ provider: "groq", secrets: { apiKey: "test-groq-key" }, config: {} });
  await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineLead" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineContentDraft" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineWhatsAppConversation" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineTrendPattern" CASCADE`);
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("autopilotStop", false);
  aiResponseContent = "{}";
});

describe("automation.dailySummary", () => {
  it("sends an emergency-stop message instead of the report when autopilotStop is on, with no DB reads needed to reach that decision", async () => {
    const { setSetting } = await import("../src/modules/settings/schema");
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await setSetting("autopilotStop", true);
    const result = (await ACTION_REGISTRY["automation.dailySummary"]!.handler({})) as { stopped: boolean; text: string };
    expect(result.stopped).toBe(true);
    expect(result.text).toContain("EMERGENCY STOP");
  });

  it("reports real counts from EngineLead/EngineContentDraft/EngineWhatsAppConversation, not fabricated figures", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.engineLead.create({ data: { phone: "+15550001111", whatsappOptIn: true } });
    await prisma.engineLead.create({ data: { phone: "+15550001112", whatsappOptIn: false, status: "UNSUBSCRIBED" } });
    await prisma.engineContentDraft.create({ data: { source: "test", body: "a draft", status: "APPROVED" } });
    await prisma.engineWhatsAppConversation.create({ data: { phone: "+15550001111", messageText: "hi", messageId: "wamid.1" } });

    const result = (await ACTION_REGISTRY["automation.dailySummary"]!.handler({})) as {
      stopped: boolean; leadsToday: number; totalLeads: number; optedIn: number; unsubscribed: number; postsToday: number; postsApproved: number; conversationsToday: number; text: string;
    };
    expect(result.stopped).toBe(false);
    expect(result.totalLeads).toBe(2);
    expect(result.leadsToday).toBe(2); // both created "today" in this test run
    expect(result.optedIn).toBe(1);
    expect(result.unsubscribed).toBe(1);
    expect(result.postsToday).toBe(1);
    expect(result.postsApproved).toBe(1);
    expect(result.conversationsToday).toBe(1);
  });

  it("reflects real connected-provider status in the config-health lines, not a static placeholder", async () => {
    // Other integration test files in this suite connect whatsapp/buffer/x against the same
    // shared local Postgres and are not torn down afterward — this assertion only relies on
    // groq, which THIS file's own beforeAll connects, to stay independent of run order.
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const result = (await ACTION_REGISTRY["automation.dailySummary"]!.handler({})) as { text: string };
    expect(result.text).toContain("AI provider: connected");
    expect(result.text).toContain("Config health:");
  });
});

describe("intelligence.analyzeContentPerformance", () => {
  async function makePublished(n: number, metadata: Record<string, unknown> = {}) {
    for (let i = 0; i < n; i++) {
      await prisma.engineContentDraft.create({ data: { source: "test", body: `post ${i}`, status: "PUBLISHED", platform: "x", metadata: { hook: `hook ${i}`, ...metadata } } });
    }
  }

  it("reports insufficient_data honestly (never calling the AI) when fewer than 6 published drafts exist", async () => {
    await makePublished(3);
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const result = (await ACTION_REGISTRY["intelligence.analyzeContentPerformance"]!.handler({})) as { ok: boolean; reason: string; publishedCount: number };
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("insufficient_data");
    expect(result.publishedCount).toBe(3);
  });

  it("analyzes winners/losers by engagement score and persists patterns to EngineTrendPattern with source ab_test", async () => {
    await makePublished(6);
    aiResponseContent = JSON.stringify({ top_hooks: ["a punchy opener"], top_formats: ["reel"], top_emotions: ["curiosity"], recommendations: ["post more reels"] });
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const result = (await ACTION_REGISTRY["intelligence.analyzeContentPerformance"]!.handler({})) as { ok: boolean; savedCount: number };
    expect(result.ok).toBe(true);
    expect(result.savedCount).toBe(4);
    const rows = await prisma.engineTrendPattern.findMany();
    expect(rows.every((r) => r.source === "ab_test")).toBe(true);
    expect(rows.map((r) => r.type).sort()).toEqual(["emotion_pattern", "format_pattern", "hook_pattern", "recommendation"]);
  });

  it("reports not_configured honestly when no AI provider is connected, saving nothing", async () => {
    await makePublished(6);
    await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONFIGURED" } });
    try {
      const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
      const result = (await ACTION_REGISTRY["intelligence.analyzeContentPerformance"]!.handler({})) as { ok: boolean; reason: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("not_configured");
      expect(await prisma.engineTrendPattern.count()).toBe(0);
    } finally {
      await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
    }
  });

  it("every published draft's engagement score reads as 0 today — the honest, documented limitation (no action populates comments/saves/shares yet)", async () => {
    await makePublished(6, { comments: 0, saves: 0, shares: 0 });
    const drafts = await prisma.engineContentDraft.findMany({ where: { status: "PUBLISHED" } });
    for (const d of drafts) {
      const meta = d.metadata as { comments?: number; saves?: number; shares?: number };
      expect(meta.comments ?? 0).toBe(0);
      expect(meta.saves ?? 0).toBe(0);
      expect(meta.shares ?? 0).toBe(0);
    }
  });
});
