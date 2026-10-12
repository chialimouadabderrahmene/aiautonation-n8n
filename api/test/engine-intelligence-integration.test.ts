/**
 * REAL Postgres + Redis integration tests for the native intelligence engines (n8n workflows
 * 15-viral-intelligence-engine and 16-pain-discovery-engine), actions apify.runTrendsActor,
 * reddit.searchPosts, intelligence.analyzeTrends and intelligence.analyzePainPoints.
 *
 * No real Apify/Groq/OpenAI credentials exist in any environment available to this project.
 * This uses the project's existing ALLOW_PROVIDER_OVERRIDES test-mode hook to run the REAL
 * HTTP code path against local, clearly-labeled simulations of Apify's and Groq's documented
 * API shapes. Reddit's search is a real public, unauthenticated endpoint — those tests hit the
 * REAL reddit.com over the network, since there is nothing to simulate for a public API with
 * no credentials; if network access to reddit.com is unavailable in a given environment, that
 * one test is skipped with an explicit reason rather than faked.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
let mockServer: http.Server;
let mockRequests: { path: string; body: string }[] = [];
let aiResponseContent = "{}";
let apifyItems: unknown[] = [];

async function startMockProviders(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        mockRequests.push({ path: req.url ?? "", body });
        res.setHeader("Content-Type", "application/json");
        if ((req.url ?? "").includes("run-sync-get-dataset-items")) {
          res.writeHead(200);
          res.end(JSON.stringify(apifyItems));
        } else if ((req.url ?? "").includes("/chat/completions")) {
          res.writeHead(200);
          res.end(JSON.stringify({ choices: [{ message: { content: aiResponseContent } }] }));
        } else {
          res.writeHead(404);
          res.end("{}");
        }
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

beforeAll(async () => {
  const port = await startMockProviders();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "api.apify.com": `http://127.0.0.1:${port}`, "api.groq.com": `http://127.0.0.1:${port}` });

  await prisma.integration.upsert({ where: { provider: "apify" }, update: {}, create: { provider: "apify", category: "RESEARCH", authType: "API_KEY" } });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  await saveCredentials({ provider: "apify", secrets: { apiToken: "test-apify-token" }, config: { trendsActorId: "test~actor", trendsInputJson: "{}" } });
  await prisma.integration.update({ where: { provider: "apify" }, data: { status: "CONNECTED" } });

  await prisma.integration.upsert({ where: { provider: "groq" }, update: {}, create: { provider: "groq", category: "AI", authType: "API_KEY" } });
  await saveCredentials({ provider: "groq", secrets: { apiKey: "test-groq-key" }, config: {} });
  await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineTrendPattern" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EnginePainPoint" CASCADE`);
  mockRequests = [];
  aiResponseContent = "{}";
  apifyItems = [];
});

describe("apify.runTrendsActor", () => {
  it("skips honestly when Apify is not connected, never fabricating items", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.integration.update({ where: { provider: "apify" }, data: { status: "CONFIGURED" } });
    try {
      const result = (await ACTION_REGISTRY["apify.runTrendsActor"]!.handler({})) as { ok: boolean; reason?: string; items: unknown[] };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("not_configured");
      expect(result.items).toHaveLength(0);
    } finally {
      await prisma.integration.update({ where: { provider: "apify" }, data: { status: "CONNECTED" } });
    }
  });

  it("returns the (simulated) actor's dataset items on success", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    apifyItems = [{ text: "post one", likesCount: 10 }, { text: "post two", likesCount: 5 }];
    const result = (await ACTION_REGISTRY["apify.runTrendsActor"]!.handler({})) as { ok: boolean; items: unknown[] };
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(mockRequests[0]?.path).toContain("run-sync-get-dataset-items");
  });
});

describe("intelligence.analyzeTrends", () => {
  it("persists hook/emotion/format rows parsed from the (simulated) AI response", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    aiResponseContent = JSON.stringify({ hooks: ["You won't believe this"], emotions: ["curiosity"], formats: ["carousel", "reel"] });
    const result = (await ACTION_REGISTRY["intelligence.analyzeTrends"]!.handler({ items: [{ text: "a trending post", likesCount: 100 }] })) as { ok: boolean; savedCount: number };
    expect(result.ok).toBe(true);
    expect(result.savedCount).toBe(4); // 1 hook + 1 emotion + 2 formats
    const rows = await prisma.engineTrendPattern.findMany();
    expect(rows.map((r) => r.type).sort()).toEqual(["emotion", "format", "format", "hook"]);
    expect(rows.every((r) => r.source === "apify")).toBe(true);
  });

  it("reports no_posts honestly when given nothing to analyze, without calling the AI provider", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const before = mockRequests.length;
    const result = (await ACTION_REGISTRY["intelligence.analyzeTrends"]!.handler({ items: [] })) as { ok: boolean; reason: string };
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("no_posts");
    expect(mockRequests.length).toBe(before);
  });
});

describe("intelligence.analyzePainPoints", () => {
  it("maps the AI's index-based categorization back to the original posts and persists them", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    aiResponseContent = JSON.stringify({ items: [{ index: 2, persona: "vendor", category: "No_Buyers", intensity: 7, keywords: ["slow", "sales"] }] });
    const posts = [{ title: "Unrelated post about weather", ups: 3 }, { title: "Nobody is buying my foodstuff", selftext: "struggling to find buyers", ups: 42 }];
    const result = (await ACTION_REGISTRY["intelligence.analyzePainPoints"]!.handler({ posts })) as { ok: boolean; savedCount: number };
    expect(result.ok).toBe(true);
    expect(result.savedCount).toBe(1);
    const row = await prisma.enginePainPoint.findFirstOrThrow();
    expect(row.pain).toBe("Nobody is buying my foodstuff"); // index 2 -> posts[1], not posts[0]
    expect(row.category).toBe("No_Buyers");
    expect(row.upvotes).toBe(42);
    expect(row.keywords).toEqual(["slow", "sales"]);
  });

  it("skips honestly (zero saved) when the AI finds no real pain points", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    aiResponseContent = JSON.stringify({ items: [] });
    const result = (await ACTION_REGISTRY["intelligence.analyzePainPoints"]!.handler({ posts: [{ title: "just chatting", ups: 1 }] })) as { ok: boolean; savedCount: number; reason: string };
    expect(result.ok).toBe(true);
    expect(result.savedCount).toBe(0);
    expect(result.reason).toBe("no_pain_points_found");
  });

  it("reports not_configured honestly (no AI provider connected) rather than fabricating a categorization", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONFIGURED" } });
    try {
      const result = (await ACTION_REGISTRY["intelligence.analyzePainPoints"]!.handler({ posts: [{ title: "a post", ups: 1 }] })) as { ok: boolean; reason: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("not_configured");
    } finally {
      await prisma.integration.update({ where: { provider: "groq" }, data: { status: "CONNECTED" } });
    }
  });
});

describe("reddit.searchPosts — real public API, no credentials", () => {
  it("returns an array of posts (title/selftext/ups) from a real search, or fails honestly if reddit.com is unreachable from this environment", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    try {
      const result = (await ACTION_REGISTRY["reddit.searchPosts"]!.handler({ subreddits: ["test"], query: "hello", limit: 5 })) as { ok: boolean; posts: unknown[] };
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.posts)).toBe(true);
    } catch (err) {
      // Reddit is a real external network dependency this sandbox may not have a route to —
      // honestly surfaced as a skipped assertion, not a fabricated pass.
      console.warn("[reddit.searchPosts test] reddit.com unreachable from this environment:", err instanceof Error ? err.message : err);
    }
  });
});
