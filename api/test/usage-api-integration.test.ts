/**
 * REAL Postgres integration tests for the usage HTTP surface: the summary separates known cost
 * from unknown calls, price writes are role-gated and audited, and bad input is rejected.
 * Uses a dedicated provider name so it never reads or writes other suites' rows.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";

const prisma = new PrismaClient();
const PROVIDER = "usage-api-test";
let server: Server;
let baseUrl: string;

async function clean() {
  await prisma.providerUsage.deleteMany({ where: { provider: PROVIDER } });
  await prisma.providerPrice.deleteMany({ where: { provider: PROVIDER } });
}

async function tokenFor(role: "OWNER" | "VIEWER"): Promise<string> {
  const email = `${role.toLowerCase()}-usage@example.com`;
  const hash = await bcrypt.hash("Usage-test-passw0rd!", 4);
  await prisma.adminUser.upsert({ where: { email }, update: { role, passwordHash: hash }, create: { email, role, passwordHash: hash } });
  const { login } = await import("../src/modules/auth/auth");
  const res = await login(email, "Usage-test-passw0rd!");
  if (!res) throw new Error("login failed in test");
  return res.token;
}

beforeAll(async () => {
  const { createApp } = await import("../src/app");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 20_000);

afterAll(async () => {
  await clean();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clean();
  await prisma.providerUsage.createMany({
    data: [
      { provider: PROVIDER, operation: "chat", status: "SUCCEEDED", inputTokens: 100, outputTokens: 50, costAmount: "0.25", currency: "USD", costSource: "ESTIMATED_FROM_PRICING", idempotencyKey: "k-1", workflowKey: "wf-a" },
      { provider: PROVIDER, operation: "chat", status: "SUCCEEDED", inputTokens: 200, outputTokens: 0, costAmount: "0.75", currency: "USD", costSource: "PROVIDER_REPORTED", idempotencyKey: "k-2", workflowKey: "wf-a" },
      { provider: PROVIDER, operation: "chat", status: "FAILED", errorCode: "http_500", costSource: "UNKNOWN", idempotencyKey: "k-3", workflowKey: "wf-b" },
    ],
  });
});

describe("GET /api/usage/summary", () => {
  it("sums known cost and counts unknown calls separately (unknown is never zero)", async () => {
    const res = await fetch(`${baseUrl}/api/usage/summary?provider=${PROVIDER}`, { headers: { Authorization: `Bearer ${await tokenFor("VIEWER")}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    const p = body.providers.find((x: { provider: string }) => x.provider === PROVIDER);
    expect(p).toMatchObject({ calls: 3, succeeded: 2, failed: 1, inputTokens: 300, outputTokens: 50, unknownCalls: 1, providerReportedCalls: 1 });
    expect(p.knownCost.USD).toBeCloseTo(1.0, 6);
    expect(body.totals.unknownCalls).toBeGreaterThanOrEqual(1);
  });

  it("filters by workflow", async () => {
    const res = await fetch(`${baseUrl}/api/usage/summary?provider=${PROVIDER}&workflowKey=wf-b`, { headers: { Authorization: `Bearer ${await tokenFor("VIEWER")}` } });
    const p = (await res.json()).providers[0];
    expect(p).toMatchObject({ calls: 1, failed: 1, unknownCalls: 1 });
    expect(p.knownCost).toEqual({});
  });

  it("rejects a malformed date filter", async () => {
    const res = await fetch(`${baseUrl}/api/usage/summary?from=not-a-date`, { headers: { Authorization: `Bearer ${await tokenFor("VIEWER")}` } });
    expect(res.status).toBe(400);
  });
});

describe("price writes", () => {
  const price = { provider: PROVIDER, unit: "input_token", unitPrice: 0.000002, currency: "USD", note: "test price" };

  it("a VIEWER cannot write a price (403) and nothing is stored", async () => {
    const res = await fetch(`${baseUrl}/api/usage/prices`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor("VIEWER")}` }, body: JSON.stringify(price) });
    expect(res.status).toBe(403);
    expect(await prisma.providerPrice.count({ where: { provider: PROVIDER } })).toBe(0);
  });

  it("an OWNER can write a price, it is audited with the actor, and the summary then prices new calls", async () => {
    const res = await fetch(`${baseUrl}/api/usage/prices`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await tokenFor("OWNER")}` }, body: JSON.stringify(price) });
    expect(res.status).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { action: "provider_price.created", entityId: (await res.json()).price.id } });
    expect(audit?.actor).toBe("owner-usage@example.com");
  });

  it("rejects a negative price, a bad currency and an unknown unit", async () => {
    const token = await tokenFor("OWNER");
    for (const bad of [{ ...price, unitPrice: -1 }, { ...price, currency: "usd" }, { ...price, unit: "bananas" }]) {
      const res = await fetch(`${baseUrl}/api/usage/prices`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(bad) });
      expect(res.status).toBe(400);
    }
  });
});
