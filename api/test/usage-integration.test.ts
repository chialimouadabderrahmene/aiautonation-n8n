/**
 * REAL Postgres integration tests for provider usage recording. Uses a dedicated provider name so
 * it never touches other suites' rows. Proves: priced calls are stored with a cost, failed calls
 * with no usage are stored as UNKNOWN (never zero), duplicate reports are stored once, retries are
 * separate spend, a DB failure never throws into the business call, and aggregation separates
 * known cost from unknown.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recordUsage, type UsageRecordInput } from "../src/lib/usage-ledger";

const prisma = new PrismaClient();
const PROVIDER = "usage-test-provider";
const EARLY = new Date("2026-01-01T00:00:00Z");

async function clean() {
  await prisma.providerUsage.deleteMany({ where: { provider: PROVIDER } });
  await prisma.providerPrice.deleteMany({ where: { provider: PROVIDER } });
}

async function seedPrices() {
  await prisma.providerPrice.createMany({
    data: [
      { provider: PROVIDER, unit: "input_token", unitPrice: "0.000002", currency: "USD", effectiveFrom: EARLY, createdBy: "test" },
      { provider: PROVIDER, unit: "output_token", unitPrice: "0.00001", currency: "USD", effectiveFrom: EARLY, createdBy: "test" },
    ],
  });
}

const base = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  provider: PROVIDER,
  model: "m-1",
  operation: "chat",
  workflowKey: "wf-test",
  executionRef: "exec_1",
  status: "SUCCEEDED",
  inputTokens: 1000,
  outputTokens: 500,
  ...over,
});

beforeEach(async () => {
  await clean();
  await seedPrices();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("recordUsage: cost and source", () => {
  it("stores a priced call with an estimated cost and the currency", async () => {
    expect(await recordUsage(base())).toBe("recorded");
    const row = await prisma.providerUsage.findFirstOrThrow({ where: { provider: PROVIDER } });
    expect(Number(row.costAmount)).toBeCloseTo(0.007, 6);
    expect(row.costSource).toBe("ESTIMATED_FROM_PRICING");
    expect(row.currency).toBe("USD");
    expect(row.workflowKey).toBe("wf-test");
  });

  it("stores a failed call with no usage as UNKNOWN with a NULL amount, not zero", async () => {
    expect(await recordUsage(base({ status: "FAILED", inputTokens: null, outputTokens: null, errorCode: "timeout" }))).toBe("recorded");
    const row = await prisma.providerUsage.findFirstOrThrow({ where: { provider: PROVIDER } });
    expect(row.costAmount).toBeNull();
    expect(row.costSource).toBe("UNKNOWN");
    expect(row.errorCode).toBe("timeout");
  });

  it("when the price table has no row for the unit, the call is stored as UNKNOWN", async () => {
    await prisma.providerPrice.deleteMany({ where: { provider: PROVIDER, unit: "output_token" } });
    await recordUsage(base());
    const row = await prisma.providerUsage.findFirstOrThrow({ where: { provider: PROVIDER } });
    expect(row.costAmount).toBeNull();
    expect(row.costSource).toBe("UNKNOWN");
  });

  it("a price that changes later does not re-price an old call (prices are dated)", async () => {
    await recordUsage(base({ executionRef: "old" }), new Date("2026-02-01T00:00:00Z"));
    await prisma.providerPrice.create({ data: { provider: PROVIDER, unit: "input_token", unitPrice: "0.1", currency: "USD", effectiveFrom: new Date("2026-03-01T00:00:00Z"), createdBy: "test" } });
    await recordUsage(base({ executionRef: "new" }), new Date("2026-04-01T00:00:00Z"));
    const old = await prisma.providerUsage.findFirstOrThrow({ where: { provider: PROVIDER, executionRef: "old" } });
    const fresh = await prisma.providerUsage.findFirstOrThrow({ where: { provider: PROVIDER, executionRef: "new" } });
    expect(Number(old.costAmount)).toBeCloseTo(0.007, 6);
    expect(Number(fresh.costAmount)).toBeCloseTo(100 + 0.005, 3);
  });
});

describe("recordUsage: duplicates, retries and failure isolation", () => {
  it("the same call attempt reported twice is stored once", async () => {
    expect(await recordUsage(base({ requestId: "req_1" }))).toBe("recorded");
    expect(await recordUsage(base({ requestId: "req_1" }))).toBe("duplicate");
    expect(await prisma.providerUsage.count({ where: { provider: PROVIDER } })).toBe(1);
  });

  it("a retry of the same execution is a new attempt and is stored separately (retries are real spend)", async () => {
    expect(await recordUsage(base({ attempt: 1, status: "FAILED", inputTokens: 1000, outputTokens: null }))).toBe("recorded");
    expect(await recordUsage(base({ attempt: 2 }))).toBe("recorded");
    expect(await prisma.providerUsage.count({ where: { provider: PROVIDER, executionRef: "exec_1" } })).toBe(2);
  });

  it("a database failure returns 'failed' and never throws into the business call", async () => {
    const outcome = await recordUsage(base({ mediaUnits: Number.NaN, mediaUnitType: "seconds" }));
    expect(outcome).toBe("failed");
    expect(await prisma.providerUsage.count({ where: { provider: PROVIDER } })).toBe(0);
  });
});

describe("cost aggregation", () => {
  it("sums known cost, counts unknown calls separately, and never reports unknown as zero", async () => {
    await recordUsage(base({ executionRef: "a" }));
    await recordUsage(base({ executionRef: "b", inputTokens: 2000, outputTokens: 0 }));
    await recordUsage(base({ executionRef: "c", status: "FAILED", inputTokens: null, outputTokens: null }));

    const rows = await prisma.providerUsage.findMany({ where: { provider: PROVIDER } });
    const known = rows.filter((r) => r.costAmount !== null).reduce((sum, r) => sum + Number(r.costAmount), 0);
    const unknown = rows.filter((r) => r.costSource === "UNKNOWN").length;

    expect(known).toBeCloseTo(0.007 + 0.004, 6);
    expect(unknown).toBe(1);
    expect(rows.length).toBe(3);
  });
});
