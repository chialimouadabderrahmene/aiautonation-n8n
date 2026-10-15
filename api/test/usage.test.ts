import { describe, expect, it } from "vitest";
import { calculateCost } from "../src/lib/usage";

describe("usage cost classification", () => {
  it("preserves provider-reported costs", () => expect(calculateCost({ idempotencyKey: "x", provider: "runway", operation: "video", providerCostMicros: 123 }).status).toBe("PROVIDER_REPORTED"));
  it("estimates only with a complete price", () => expect(calculateCost({ idempotencyKey: "x", provider: "ai", operation: "chat", inputUnits: 10, outputUnits: 5 }, { inputMicros: 2, outputMicros: 4 }).costMicros).toBe(40));
  it("does not turn missing prices into zero", () => expect(calculateCost({ idempotencyKey: "x", provider: "ai", operation: "chat", inputUnits: 10 }).status).toBe("UNKNOWN"));
});
