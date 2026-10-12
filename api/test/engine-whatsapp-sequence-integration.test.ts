/**
 * REAL Postgres + Redis integration tests for the native WhatsApp sequence engine
 * (05-whatsapp-welcome-sequence, 06-whatsapp-engagement-followup, 19-whatsapp-nurture-
 * sequences — all driven by the single `whatsapp.runSequence` action). Run explicitly:
 *   DATABASE_URL=... REDIS_URL=... npm run test:integration
 *
 * No real Meta/WhatsApp credentials exist in any environment available to this project.
 * The "a real provider confirms the send" tests below use Node's built-in http server as a
 * LABELED, LOCAL SIMULATION of the WhatsApp Cloud API's Graph endpoint, reached through the
 * api's own documented ALLOW_PROVIDER_OVERRIDES/PROVIDER_API_OVERRIDES test-mode mechanism
 * (lib/http.ts) — the same real code path (timedFetch → describeHttpFailure → withRetry) runs
 * against it as would run against the real graph.facebook.com; only the DNS/network hop is
 * substituted. This is never claimed as a real-provider (STAGING/PRODUCTION VERIFIED) result.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
let mockServer: http.Server;
let mockPort: number;
let mockRequests: { path: string; body: string }[] = [];

async function startMockWhatsAppServer(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        mockRequests.push({ path: req.url ?? "", body });
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ messages: [{ id: `wamid.SIMULATED${mockRequests.length}` }] }));
      });
    });
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      mockPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve(mockPort);
    });
  });
}

async function configureWhatsAppConnected(): Promise<void> {
  await prisma.integration.upsert({
    where: { provider: "whatsapp" },
    update: {},
    create: { provider: "whatsapp", category: "MESSAGING", authType: "API_KEY" },
  });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  const { templateFieldName } = await import("../src/modules/providers/definitions");
  await saveCredentials({
    provider: "whatsapp",
    secrets: { accessToken: "test-access-token", appSecret: "test-app-secret", verifyToken: "test-verify-token" },
    config: {
      phoneNumberId: "1234567890",
      graphVersion: "v23.0",
      templateLang: "en",
      maxPerRun: "40",
      [templateFieldName("WELCOME_D1")]: "welcome_d1",
      [templateFieldName("WELCOME_D2")]: "welcome_d2",
      [templateFieldName("WELCOME_D3")]: "welcome_d3",
      [templateFieldName("REENGAGE_7")]: "reengage_7",
      [templateFieldName("NURTURE_VENDOR_D1")]: "nurture_vendor_d1",
      [templateFieldName("NURTURE_BUYER_D1")]: "nurture_buyer_d1",
    },
  });
  // saveCredentials() only ever sets status to CONFIGURED (a real testConnection() call is
  // what earns CONNECTED in production) — directly setting it here is the one deliberate
  // shortcut in this test, since exercising the real test-connection HTTP flow is a separate,
  // already-covered concern (routes/integrations.ts), not what this suite is testing.
  await prisma.integration.update({ where: { provider: "whatsapp" }, data: { status: "CONNECTED" } });
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("whatsappTemplatesApproved", true);
}

beforeAll(async () => {
  for (const table of ["EngineLead"]) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
  }
  const port = await startMockWhatsAppServer();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "graph.facebook.com": `http://127.0.0.1:${port}` });
  await configureWhatsAppConnected();
}, 20_000);

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  await prisma.$disconnect();
});

// Each scenario below creates its own lead(s) with specific day-offsets, and whatsapp.
// runSequence's query has no workflow-id scoping (it is a plain "all eligible leads" query,
// matching the real workflow) — so a lead left over from a previous test is a real candidate
// in the next one. Truncate between tests to keep each scenario isolated; this does NOT
// truncate Integration/Setting (the WhatsApp-connected fixture set up once in beforeAll).
beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EngineLead" CASCADE`);
  mockRequests = [];
});

describe("whatsapp.runSequence — not configured / consent", () => {
  it("skips the whole run honestly, sending nothing, when WhatsApp templates are not approved", async () => {
    const { setSetting } = await import("../src/modules/settings/schema");
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    await setSetting("whatsappTemplatesApproved", false);
    const result = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({
      sequenceKey: "welcome", referenceField: "createdAt", stages: [{ dayOffset: 1, templateKey: "WELCOME_D1" }],
    })) as { sent: number; reason?: string };
    expect(result.sent).toBe(0);
    expect(result.reason).toBe("not_configured");
    await setSetting("whatsappTemplatesApproved", true); // restore for the rest of the suite
  });

  it("never sends to an opted-out lead even once it is otherwise due", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.engineLead.create({ data: { phone: "+15550000001", createdAt: twoDaysAgo, whatsappOptIn: false } });
    const before = mockRequests.length;
    const result = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({
      sequenceKey: "welcome", referenceField: "createdAt", stages: [{ dayOffset: 1, templateKey: "WELCOME_D1" }],
    })) as { sent: number };
    expect(result.sent).toBe(0);
    expect(mockRequests.length).toBe(before); // no HTTP call was made for this lead, not just "a failed one"
  });
});

describe("whatsapp.runSequence — a simulated provider confirms the send", () => {
  it("sends the due stage once, advances sequenceState, and never re-sends that SAME stage on a later run", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const lead = await prisma.engineLead.create({ data: { phone: "+15550000002", createdAt: twoDaysAgo, whatsappOptIn: true } });

    // A single-stage array isolates "does this exact stage ever fire twice" from the separate,
    // intentional "catch-up" behavior covered by the next test (one stage advances per run).
    const stages = [{ dayOffset: 1, templateKey: "WELCOME_D1" }];
    const before = mockRequests.length;
    const run1 = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({ sequenceKey: "welcome", referenceField: "createdAt", stages })) as { sent: number; perLead: { leadId: string; result: string }[] };
    expect(run1.sent).toBe(1);
    expect(run1.perLead.some((p) => p.leadId === lead.id && p.result === "sent")).toBe(true);
    expect(mockRequests.length).toBe(before + 1); // exactly one real HTTP call reached the (simulated) provider

    const afterRun1 = await prisma.engineLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect((afterRun1.sequenceState as Record<string, { stage: number }>).welcome?.stage).toBe(1);

    // Running again (same lead, same day, same stage list) must not re-send D1.
    const beforeRun2 = mockRequests.length;
    const run2 = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({ sequenceKey: "welcome", referenceField: "createdAt", stages })) as { sent: number };
    expect(run2.sent).toBe(0);
    expect(mockRequests.length).toBe(beforeRun2);
  });

  it("advances exactly one stage per run even when a lead is old enough to be eligible for several (catch-up is gradual, not a burst)", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const lead = await prisma.engineLead.create({ data: { phone: "+15550000003", createdAt: twoDaysAgo, whatsappOptIn: true } });
    const stages = [{ dayOffset: 1, templateKey: "WELCOME_D1" }, { dayOffset: 2, templateKey: "WELCOME_D2" }];

    const run1 = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({ sequenceKey: "welcome", referenceField: "createdAt", stages })) as { sent: number };
    expect(run1.sent).toBe(1);
    let row = await prisma.engineLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect((row.sequenceState as Record<string, { stage: number }>).welcome?.stage).toBe(1); // D1 only

    const run2 = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({ sequenceKey: "welcome", referenceField: "createdAt", stages })) as { sent: number };
    expect(run2.sent).toBe(1);
    row = await prisma.engineLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect((row.sequenceState as Record<string, { stage: number }>).welcome?.stage).toBe(2); // now D2 too

    const run3 = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({ sequenceKey: "welcome", referenceField: "createdAt", stages })) as { sent: number };
    expect(run3.sent).toBe(0); // nothing left to catch up on
  });

  it("the nurture sequence skips a lead with no leadType set, and sends only to the matching track", async () => {
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const unknownLead = await prisma.engineLead.create({ data: { phone: "+15550000004", createdAt: twoDaysAgo, whatsappOptIn: true } }); // leadType defaults to UNKNOWN
    const vendorLead = await prisma.engineLead.create({ data: { phone: "+15550000005", createdAt: twoDaysAgo, whatsappOptIn: true, leadType: "VENDOR" } });

    const vendorRun = (await ACTION_REGISTRY["whatsapp.runSequence"]!.handler({
      sequenceKey: "nurture", referenceField: "createdAt", leadTypeFilter: "VENDOR", stages: [{ dayOffset: 1, templateKey: "NURTURE_VENDOR_D1" }],
    })) as { sent: number; perLead: { leadId: string }[] };
    expect(vendorRun.perLead.some((p) => p.leadId === unknownLead.id)).toBe(false); // never even considered
    expect(vendorRun.perLead.some((p) => p.leadId === vendorLead.id)).toBe(true);
  });
});
