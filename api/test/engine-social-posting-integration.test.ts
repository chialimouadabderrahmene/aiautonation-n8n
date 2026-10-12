/**
 * REAL Postgres + Redis integration tests for native social posting (n8n workflows
 * 10-social-post-scheduler and 12-ai-social-autopilot's posting half), action
 * content.postApprovedDraft. No real X/Buffer credentials exist in any environment
 * available to this project — these use the project's existing ALLOW_PROVIDER_OVERRIDES
 * test-mode hook to run the REAL HTTP code path (timedFetch/withRetry/describeHttpFailure)
 * against a local, clearly-labeled simulation of each provider's documented API shape.
 * Nothing here is reported as more than LOCALLY TESTED.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
let mockServer: http.Server;
let mockRequests: { host: string; path: string; body: string }[] = [];
let xStatusCode = 201;
let bufferSuccess = true;

async function startMockSocialProviders(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        mockRequests.push({ host: req.headers.host ?? "", path: req.url ?? "", body });
        res.setHeader("Content-Type", "application/json");
        if ((req.url ?? "").includes("/2/tweets")) {
          res.writeHead(xStatusCode);
          res.end(xStatusCode < 300 ? JSON.stringify({ data: { id: `tweet-${mockRequests.length}` } }) : JSON.stringify({ error: "simulated X failure" }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify(bufferSuccess ? { success: true, updates: [{ id: `buffer-${mockRequests.length}` }] } : { success: false }));
        }
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

async function connectProvider(provider: "x" | "buffer", config: Record<string, string>, secrets: Record<string, string>): Promise<void> {
  await prisma.integration.upsert({
    where: { provider },
    update: {},
    create: { provider, category: "SOCIAL", authType: provider === "x" ? "OAUTH" : "API_KEY" },
  });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  await saveCredentials({ provider, secrets, config });
  await prisma.integration.update({ where: { provider }, data: { status: "CONNECTED" } });
}

beforeAll(async () => {
  const port = await startMockSocialProviders();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "api.twitter.com": `http://127.0.0.1:${port}`, "api.bufferapp.com": `http://127.0.0.1:${port}` });
  await connectProvider("x", {}, { accessToken: "test-x-token" });
  await connectProvider("buffer", { profileIdInstagram: "ig-profile-1" }, { accessToken: "test-buffer-token" });
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("autopilotStop", false);
  await setSetting("autopilotSocialPosting", true);
  await setSetting("twitterPostingEnabled", true);
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineContentDraft" CASCADE`);
  mockRequests = [];
  xStatusCode = 201;
  bufferSuccess = true;
});

async function makeDraft(platform: string, body = "a post") {
  return prisma.engineContentDraft.create({ data: { source: "test", platform, body, status: "APPROVED" } });
}

describe("content.postApprovedDraft — kill switches (checked BEFORE any provider call)", () => {
  it("does nothing when autopilotStop is on, even with an approved draft waiting", async () => {
    const { setSetting } = await import("../src/modules/settings/schema");
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await makeDraft("x");
    await setSetting("autopilotStop", true);
    try {
      const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
      expect(result.posted).toBe(false);
      expect(result.reason).toBe("autopilot_stopped");
      expect(mockRequests).toHaveLength(0);
    } finally {
      await setSetting("autopilotStop", false);
    }
  });

  it("does nothing when autopilotSocialPosting is off", async () => {
    const { setSetting } = await import("../src/modules/settings/schema");
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await makeDraft("x");
    await setSetting("autopilotSocialPosting", false);
    try {
      const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
      expect(result.posted).toBe(false);
      expect(result.reason).toBe("autopilot_disabled");
      expect(mockRequests).toHaveLength(0);
    } finally {
      await setSetting("autopilotSocialPosting", true);
    }
  });

  it("reports no_approved_drafts honestly when the queue is empty, rather than erroring", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
    expect(result.posted).toBe(false);
    expect(result.reason).toBe("no_approved_drafts");
  });

  it("never posts a DRAFT (unreviewed) draft — only APPROVED ones are eligible", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.engineContentDraft.create({ data: { source: "test", platform: "x", body: "unreviewed", status: "DRAFT" } });
    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
    expect(result.posted).toBe(false);
    expect(result.reason).toBe("no_approved_drafts");
    expect(mockRequests).toHaveLength(0);
  });
});

describe("content.postApprovedDraft — a simulated provider confirms the post", () => {
  it("posts the OLDEST approved draft to X, marks it PUBLISHED with the real tweet id, and never claims success until the provider confirms it", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const older = await makeDraft("x", "older post");
    await new Promise((r) => setTimeout(r, 10));
    await makeDraft("x", "newer post");

    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; draftId: string; publishedVia: string; providerId: string };
    expect(result.posted).toBe(true);
    expect(result.draftId).toBe(older.id); // oldest first
    expect(result.publishedVia).toBe("x");
    expect(result.providerId).toBe("tweet-1");

    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: older.id } });
    expect(row.status).toBe("PUBLISHED");
    expect((row.metadata as Record<string, unknown>).providerId).toBe("tweet-1");
  });

  it("posts to Buffer using the correct per-platform profile id", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const draft = await makeDraft("instagram");
    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; publishedVia: string };
    expect(result.posted).toBe(true);
    expect(result.publishedVia).toBe("buffer");
    expect(mockRequests[0]?.body).toContain("ig-profile-1");
    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("PUBLISHED");
  });

  it("a provider failure leaves the draft APPROVED (never falsely marked PUBLISHED) and records the reason", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    xStatusCode = 500;
    const draft = await makeDraft("x");
    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
    expect(result.posted).toBe(false);
    expect(result.reason).toBe("provider_error");
    const row = await prisma.engineContentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe("APPROVED"); // untouched — never falsely marked published
    expect(row.reviewNote).toContain("Publish failed");
  });

  it("skips X posting when twitterPostingEnabled is off, even though X is connected and a draft is approved", async () => {
    const { setSetting } = await import("../src/modules/settings/schema");
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await makeDraft("x");
    await setSetting("twitterPostingEnabled", false);
    try {
      const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
      expect(result.posted).toBe(false);
      expect(result.reason).toBe("twitter_posting_disabled");
      expect(mockRequests).toHaveLength(0);
    } finally {
      await setSetting("twitterPostingEnabled", true);
    }
  });

  it("an unconfigured Buffer profile for a platform is reported honestly, not posted to the wrong profile", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await makeDraft("tiktok"); // no profileIdTiktok was configured in beforeAll
    const result = (await ACTION_REGISTRY["content.postApprovedDraft"]!.handler({})) as { posted: boolean; reason: string };
    expect(result.posted).toBe(false);
    expect(result.reason).toBe("not_configured");
  });
});
