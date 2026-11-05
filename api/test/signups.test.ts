import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-ins for the handful of Prisma calls this flow makes.
type Row = Record<string, any>;
const db = vi.hoisted(() => ({ events: [] as Row[], executions: [] as Row[], settings: new Map<string, unknown>(), telegramConnected: true }));

vi.mock("../src/lib/prisma", () => {
  let seq = 0;
  const id = () => `id_${++seq}`;
  return {
    prisma: {
      attributionEvent: {
        upsert: async ({ where, create }: Row) => {
          const found = db.events.find((e) => e.eventId === where.eventId);
          if (found) return found;
          const row = { id: id(), createdAt: new Date(), campaignId: null, source: null, campaignName: null, ...create };
          db.events.push(row);
          return row;
        },
        findMany: async ({ where }: Row) => db.events.filter((e) => e.eventType === where.eventType && e.createdAt >= where.createdAt.gte),
      },
      automationExecution: {
        findMany: async ({ where }: Row) => db.executions.filter((x) => x.source === where.source && where.externalId.in.includes(x.externalId)),
        create: async ({ data }: Row) => {
          await Promise.resolve();
          if (db.executions.some((x) => x.source === data.source && x.externalId === data.externalId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          const row = { id: id(), status: "RUNNING", startedAt: new Date(), error: null, ...data };
          db.executions.push(row);
          return row;
        },
        update: async ({ where, data }: Row) => Object.assign(db.executions.find((x) => x.id === where.id)!, data),
      },
      setting: { findUnique: async ({ where }: Row) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null) },
      integration: { findUnique: async () => ({ status: db.telegramConnected ? "CONNECTED" : "DISCONNECTED" }) },
    },
  };
});

vi.mock("../src/modules/integrations/vault", () => ({
  getProviderValues: async (provider: string) =>
    provider === "webhooks" ? { sharedSecret: "shared-secret-123" } : provider === "telegram" ? { botToken: "123:abc", approvalChatId: "-10042" } : null,
  getDecryptedCredentials: async () => null,
  generateSecretValue: () => "generated",
}));

const realFetch = globalThis.fetch;
const telegramCalls: { url: string; body: Row }[] = [];
let telegramOk = true;
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  if (!String(url).startsWith("https://api.telegram.org/")) return realFetch(url, init);
  telegramCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify(telegramOk ? { ok: true, result: { message_id: 1 } } : { ok: false, description: "chat not found" }));
});

const { attributionPublicRouter } = await import("../src/routes/attribution");
const { formatSignupMessage, processSignupEvents, runSignupProcessing, summarizeSignups } = await import("../src/modules/signups/processor");

const sample = (overrides: Row = {}) => ({
  eventId: "eki:user:user_1:registered",
  eventType: "registration",
  leadId: "user_1",
  source: "instagram",
  campaignName: "launch",
  occurredAt: "2026-10-21T23:32:44.891Z",
  metadata: { origin: "eki-marketplace", kind: "user_registered", userId: "user_1", role: "BUYER", country: "IT", signupMethod: "google", referred: true, emailVerified: false, isTest: false },
  ...overrides,
});

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/attribution", attributionPublicRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  db.events.length = 0;
  db.executions.length = 0;
  db.settings.clear();
  db.telegramConnected = true;
  telegramCalls.length = 0;
  telegramOk = true;
});

const post = (body: unknown, secret = "shared-secret-123") =>
  realFetch(`${base}/api/attribution/events`, { method: "POST", headers: { "content-type": "application/json", "x-eki-webhook-secret": secret }, body: JSON.stringify(body) });

describe("Eki signup → operator Telegram alert", () => {
  it("a sample event posted with the shared secret yields one execution and one Telegram call", async () => {
    expect((await post(sample())).status).toBe(202);
    await runSignupProcessing();

    expect(db.executions).toHaveLength(1);
    expect(db.executions[0]).toMatchObject({ source: "CONTROL_CENTER", externalId: "eki:user:user_1:registered", trigger: "eki_signup", status: "SUCCESS", relatedEntityType: "AttributionEvent", mode: "user_registered" });
    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0].url).toContain("/sendMessage");
    expect(telegramCalls[0].body.chat_id).toBe("-10042");
    expect(telegramCalls[0].body.text).toContain("New Eki account");
    expect(telegramCalls[0].body.text).toContain("Country: IT");
  });

  it("never double-processes: redelivery and repeat runs keep one row and one call", async () => {
    await post(sample());
    await runSignupProcessing();
    await post(sample());
    await runSignupProcessing();
    await processSignupEvents();
    expect(db.executions).toHaveLength(1);
    expect(telegramCalls).toHaveLength(1);
  });

  it("concurrent runs claim each event once", async () => {
    await post(sample());
    await runSignupProcessing();
    db.executions.length = 0;
    telegramCalls.length = 0;
    await Promise.all([processSignupEvents(), processSignupEvents(), processSignupEvents()]);
    expect(db.executions).toHaveLength(1);
    expect(telegramCalls).toHaveLength(1);
  });

  it("rejects a wrong secret without storing or alerting", async () => {
    expect((await post(sample(), "wrong-secret-xyz")).status).toBe(401);
    await runSignupProcessing();
    expect(db.events).toHaveLength(0);
    expect(telegramCalls).toHaveLength(0);
  });

  it("records test accounts as CANCELLED without a Telegram call", async () => {
    await post(sample({ metadata: { ...sample().metadata, isTest: true } }));
    await runSignupProcessing();
    expect(db.executions).toHaveLength(1);
    expect(db.executions[0].status).toBe("CANCELLED");
    expect(telegramCalls).toHaveLength(0);
  });

  it("respects emergency stop, then catches up once it is lifted", async () => {
    db.settings.set("autopilotStop", true);
    await post(sample());
    await runSignupProcessing();
    expect(await processSignupEvents()).toMatchObject({ blocked: true });
    expect(db.executions).toHaveLength(0);
    expect(telegramCalls).toHaveLength(0);

    db.settings.set("autopilotStop", false);
    expect(await processSignupEvents()).toMatchObject({ sent: 1 });
    expect(telegramCalls).toHaveLength(1);
  });

  it("records a Telegram failure as FAILED and does not retry it", async () => {
    telegramOk = false;
    await post(sample());
    await runSignupProcessing();
    expect(db.executions[0].status).toBe("FAILED");
    expect(db.executions[0].error).toContain("chat not found");
    await processSignupEvents();
    expect(telegramCalls).toHaveLength(1);
  });

  it("fails cleanly when Telegram is not connected", async () => {
    db.telegramConnected = false;
    await post(sample());
    await runSignupProcessing();
    expect(db.executions[0]).toMatchObject({ status: "FAILED", error: "Telegram is not connected" });
    expect(telegramCalls).toHaveLength(0);
  });

  it("handles vendor store events and ignores unrelated registration events", async () => {
    await post(sample({ eventId: "eki:vendor:v_1:store_created", metadata: { kind: "vendor_store_created", role: "VENDOR", country: "NG", signupMethod: "password" } }));
    await post(sample({ eventId: "other-1", metadata: { kind: "something_else" } }));
    await runSignupProcessing();
    expect(db.executions.map((x) => x.externalId)).toEqual(["eki:vendor:v_1:store_created"]);
    expect(telegramCalls[0].body.text).toContain("New Eki vendor store");
  });
});

describe("signup formatting and reporting", () => {
  it("formats an alert without personal data", () => {
    const text = formatSignupMessage({ kind: "user_registered", role: "BUYER", country: "IT", signupMethod: "apple", referred: false }, { source: null, campaignName: null, occurredAt: new Date("2026-10-21T00:00:00Z") });
    expect(text).toBe("🆕 New Eki account\nRole: BUYER · Country: IT\nSignup: apple\nAt: 2026-10-21T00:00:00.000Z");
  });
  it("summarizes signups by kind and alert outcome", () => {
    const summary = summarizeSignups(
      [{ metadata: { kind: "user_registered" } }, { metadata: { kind: "vendor_store_created" } }, { metadata: { kind: "user_registered", isTest: true } }, { metadata: { kind: "nope" } }],
      [{ status: "SUCCESS" }, { status: "FAILED" }, { status: "CANCELLED" }],
    );
    expect(summary).toEqual({ users: 1, vendorStores: 1, testAccounts: 1, alertsSent: 1, alertsFailed: 1 });
  });
});
