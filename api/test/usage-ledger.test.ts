import { describe, it, expect } from "vitest";
import { pickPrice, computeCost, usageIdempotencyKey, type PriceRow, type UsageRecordInput } from "../src/lib/usage-ledger";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-06-01T00:00:00Z");

const price = (over: Partial<PriceRow>): PriceRow => ({ provider: "openai", model: null, unit: "input_token", unitPrice: 0.000001, currency: "USD", effectiveFrom: T0, ...over });

const call = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({ provider: "openai", model: "gpt-x", operation: "chat", status: "SUCCEEDED", ...over });

describe("pickPrice", () => {
  it("prefers a model-specific row over a provider-wide row", () => {
    const rows = [price({ unitPrice: 1 }), price({ model: "gpt-x", unitPrice: 2 })];
    expect(pickPrice(rows, "openai", "gpt-x", "input_token", NOW)?.unitPrice).toBe(2);
  });

  it("uses the newest row that is effective at the given instant (price changes are dated)", () => {
    const rows = [price({ unitPrice: 1, effectiveFrom: T0 }), price({ unitPrice: 5, effectiveFrom: new Date("2026-03-01T00:00:00Z") })];
    expect(pickPrice(rows, "openai", "gpt-x", "input_token", new Date("2026-02-01T00:00:00Z"))?.unitPrice).toBe(1);
    expect(pickPrice(rows, "openai", "gpt-x", "input_token", NOW)?.unitPrice).toBe(5);
  });

  it("ignores rows for another provider, unit, model or a future effective date", () => {
    const rows = [price({ provider: "runway" }), price({ unit: "second" }), price({ model: "other" }), price({ effectiveFrom: new Date("2027-01-01T00:00:00Z") })];
    expect(pickPrice(rows, "openai", "gpt-x", "input_token", NOW)).toBeNull();
  });
});

describe("computeCost", () => {
  it("prefers the provider's own reported cost and marks it PROVIDER_REPORTED", () => {
    const out = computeCost(call({ providerReportedCost: { amount: 0.42, currency: "usd" } }), [], NOW);
    expect(out).toEqual({ amount: 0.42, currency: "usd", source: "PROVIDER_REPORTED" });
  });

  it("estimates from token prices: input plus output", () => {
    const rows = [price({ unit: "input_token", unitPrice: 0.000002 }), price({ unit: "output_token", unitPrice: 0.00001 })];
    const out = computeCost(call({ inputTokens: 1000, outputTokens: 500 }), rows, NOW);
    expect(out).toEqual({ amount: 0.007, currency: "USD", source: "ESTIMATED_FROM_PRICING" });
  });

  it("estimates media usage (seconds of video, characters of speech)", () => {
    const rows = [price({ provider: "runway", unit: "second", unitPrice: 0.01 })];
    expect(computeCost(call({ provider: "runway", model: null, mediaUnits: 10, mediaUnitType: "seconds" }), rows, NOW)).toMatchObject({ amount: 0.1, source: "ESTIMATED_FROM_PRICING" });
  });

  it("a missing price for any billable component yields UNKNOWN with a NULL amount, never zero", () => {
    const rows = [price({ unit: "input_token", unitPrice: 0.000002 })];
    const out = computeCost(call({ inputTokens: 1000, outputTokens: 500 }), rows, NOW);
    expect(out.amount).toBeNull();
    expect(out.source).toBe("UNKNOWN");
  });

  it("a call with no usage data at all is UNKNOWN (failed calls often have none)", () => {
    expect(computeCost(call({ status: "FAILED", errorCode: "timeout" }), [price({})], NOW)).toEqual({ amount: null, currency: "USD", source: "UNKNOWN" });
  });

  it("a genuine zero token count is priced at zero and is not treated as unknown", () => {
    const out = computeCost(call({ inputTokens: 0, outputTokens: 0 }), [price({ unit: "input_token" }), price({ unit: "output_token" })], NOW);
    expect(out).toMatchObject({ amount: 0, source: "ESTIMATED_FROM_PRICING" });
  });

  it("mixed currencies are not summed: UNKNOWN", () => {
    const rows = [price({ unit: "input_token", currency: "USD" }), price({ unit: "output_token", currency: "EUR" })];
    expect(computeCost(call({ inputTokens: 1, outputTokens: 1 }), rows, NOW)).toMatchObject({ amount: null, source: "UNKNOWN" });
  });

  it("a non-finite provider-reported amount is ignored and the estimate is used instead", () => {
    const rows = [price({ unit: "input_token", unitPrice: 1 })];
    const out = computeCost(call({ inputTokens: 2, providerReportedCost: { amount: Number.NaN, currency: "USD" } }), rows, NOW);
    expect(out).toMatchObject({ amount: 2, source: "ESTIMATED_FROM_PRICING" });
  });
});

describe("usageIdempotencyKey", () => {
  it("the same call attempt reported twice yields the same key (duplicate events are stored once)", () => {
    const a = usageIdempotencyKey(call({ executionRef: "exec_1", attempt: 1, requestId: "req_9" }));
    const b = usageIdempotencyKey(call({ executionRef: "exec_1", attempt: 1, requestId: "req_9", inputTokens: 999 }));
    expect(a).toBe(b);
  });

  it("a retry of the same execution is a different attempt and gets a different key (retries are real spend)", () => {
    const first = usageIdempotencyKey(call({ executionRef: "exec_1", attempt: 1 }));
    const second = usageIdempotencyKey(call({ executionRef: "exec_1", attempt: 2 }));
    expect(first).not.toBe(second);
  });

  it("different operations or executions never collide", () => {
    expect(usageIdempotencyKey(call({ operation: "chat", executionRef: "e1" }))).not.toBe(usageIdempotencyKey(call({ operation: "tts", executionRef: "e1" })));
    expect(usageIdempotencyKey(call({ executionRef: "e1" }))).not.toBe(usageIdempotencyKey(call({ executionRef: "e2" })));
  });

  it("is a 64-character hex digest", () => {
    expect(usageIdempotencyKey(call())).toMatch(/^[0-9a-f]{64}$/);
  });
});
