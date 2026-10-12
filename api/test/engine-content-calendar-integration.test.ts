/**
 * REAL Postgres + Redis integration tests for the native content-calendar flow (n8n workflows
 * 01-ai-content-generation and 02-content-approval), action contentCalendar.generateDraft and
 * the Telegram command handler handleContentApprovalCommand. No real AI provider credentials
 * exist in any environment available to this project — a labeled local simulation (the
 * project's existing ALLOW_PROVIDER_OVERRIDES hook) exercises the real HTTP code path.
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

const DAY1_DRAFT_AI = JSON.stringify({ hook: "Hook!", caption: "A great caption about Eki.", hashtags: "#Eki #Marketplace", video_script: "[Visual: vendor] Script text." });

beforeAll(async () => {
  const port = await startMockAiProvider();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "api.groq.com": `http://127.0.0.1:${port}` });
  await prisma.integration.upsert({ where: { provider: "groq" }, update: {}, create: { provider: "groq", category: "AI", authType: "API_KEY" } });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  await saveCredentials({ provider: "groq", secrets: { apiKey: "test-groq-key" }, config: {} });
  await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("launchDate", new Date().toISOString().slice(0, 10)); // today = day 1
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineContentDraft" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineContentCalendarEntry" CASCADE`);
  aiResponseContent = DAY1_DRAFT_AI;
});

describe("contentCalendar.generateDraft", () => {
  it("skips honestly when no EngineContentCalendarEntry exists for today's day-number", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const result = (await ACTION_REGISTRY["contentCalendar.generateDraft"]!.handler({})) as { ok: boolean; reason: string; dayNumber: number };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_calendar_entry");
    expect(result.dayNumber).toBe(1);
  });

  it("drafts today's post from the calendar entry and builds a real approval-request message", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.engineContentCalendarEntry.create({ data: { dayNumber: 1, platform: "Instagram", topicBrief: "Launch week excitement" } });
    const result = (await ACTION_REGISTRY["contentCalendar.generateDraft"]!.handler({})) as { ok: boolean; posted: boolean; draftId: string; approvalText: string };
    expect(result.ok).toBe(true);
    expect(result.posted).toBe(true);
    expect(result.approvalText).toContain("/approve 1");
    expect(result.approvalText).toContain("/reject 1");
    const draft = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: result.draftId } });
    expect(draft.dayNumber).toBe(1);
    expect(draft.platform).toBe("Instagram");
    expect(draft.body).toBe("A great caption about Eki.");
    expect(draft.hashtags).toEqual(["#Eki", "#Marketplace"]);
    expect((draft.metadata as Record<string, unknown>).hook).toBe("Hook!");
  });

  it("never drafts the same day twice — a second run finds the existing draft and no-ops", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.engineContentCalendarEntry.create({ data: { dayNumber: 1, platform: "Instagram", topicBrief: "Launch week excitement" } });
    const first = (await ACTION_REGISTRY["contentCalendar.generateDraft"]!.handler({})) as { draftId: string };
    const second = (await ACTION_REGISTRY["contentCalendar.generateDraft"]!.handler({})) as { ok: boolean; posted: boolean; reason: string; draftId: string };
    expect(second.posted).toBe(false);
    expect(second.reason).toBe("already_drafted");
    expect(second.draftId).toBe(first.draftId);
    expect(await prisma.engineContentDraft.count()).toBe(1);
  });

  it("reports not_configured honestly when no AI provider is connected, drafting nothing", async () => {
    await prisma.engineContentCalendarEntry.create({ data: { dayNumber: 1, platform: "Instagram", topicBrief: "x" } });
    await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONFIGURED" } });
    try {
      const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
      const result = (await ACTION_REGISTRY["contentCalendar.generateDraft"]!.handler({})) as { ok: boolean; reason: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("not_configured");
      expect(await prisma.engineContentDraft.count()).toBe(0);
    } finally {
      await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
    }
  });
});

describe("handleContentApprovalCommand — the native Telegram /approve /reject /edit handler", () => {
  async function makeDraft(dayNumber: number) {
    return prisma.engineContentDraft.create({ data: { source: "ai-content-generation", dayNumber, platform: "Instagram", body: "original caption", metadata: { hook: "original hook", videoScript: "original script" } } });
  }

  it("ignores free text that isn't a recognized command", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    const result = await handleContentApprovalCommand("just chatting here");
    expect(result.handled).toBe(false);
  });

  it("/approve <day> moves a DRAFT to APPROVED and confirms", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    const draft = await makeDraft(3);
    const result = await handleContentApprovalCommand("/approve 3");
    expect(result.handled).toBe(true);
    expect(result.replyText).toContain("approved");
    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("APPROVED");
    expect(row.reviewedBy).toBe("telegram");
  });

  it("/reject <day> moves a DRAFT to REJECTED and confirms", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    const draft = await makeDraft(4);
    const result = await handleContentApprovalCommand("/reject 4");
    expect(result.replyText).toContain("rejected");
    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("REJECTED");
  });

  it("refuses to re-approve an already-decided draft rather than silently re-applying it", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    await makeDraft(5);
    await handleContentApprovalCommand("/approve 5");
    const second = await handleContentApprovalCommand("/approve 5");
    expect(second.replyText).toContain("already");
  });

  it("/edit <day> <feedback> calls the AI, overwrites the draft with the revision, and resets it to DRAFT for re-approval", async () => {
    aiResponseContent = JSON.stringify({ hook: "Revised hook", caption: "Revised caption text.", hashtags: "#Eki #Revised", video_script: "Revised script." });
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    const draft = await makeDraft(6);
    const result = await handleContentApprovalCommand("/edit 6 make it punchier");
    expect(result.handled).toBe(true);
    expect(result.replyText).toContain("/approve 6");
    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.body).toBe("Revised caption text.");
    expect(row.status).toBe("DRAFT"); // reset for re-approval, not auto-approved
    expect((row.metadata as Record<string, unknown>).hook).toBe("Revised hook");
  });

  it("/edit with no feedback text is rejected with a usage hint, and never calls the AI", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    await makeDraft(7);
    const result = await handleContentApprovalCommand("/edit 7");
    expect(result.replyText).toContain("Usage:");
    const row = await prisma.engineContentDraft.findFirstOrThrow({ where: { dayNumber: 7 } });
    expect(row.body).toBe("original caption"); // untouched
  });

  it("a command for a day with no draft is reported honestly, not silently ignored", async () => {
    const { handleContentApprovalCommand } = await import("../src/modules/engine/contentCalendarCommands");
    const result = await handleContentApprovalCommand("/approve 99");
    expect(result.handled).toBe(true);
    expect(result.replyText).toContain("No content draft found");
  });
});
