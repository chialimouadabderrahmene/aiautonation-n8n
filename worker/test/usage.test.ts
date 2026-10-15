import { describe, expect, it } from "vitest";
import { calculateCost } from "../src/lib/usage";

describe("worker usage cost classification", () => {
  it("keeps provider and estimate states distinct", () => {
    expect(calculateCost({ idempotencyKey: "x", provider: "runway", operation: "video", providerCostMicros: 123 }).status).toBe("PROVIDER_REPORTED");
    expect(calculateCost({ idempotencyKey: "y", provider: "runway", operation: "video", totalUnits: 2 }, { unitMicros: 50 }).costMicros).toBe(100);
    expect(calculateCost({ idempotencyKey: "z", provider: "runway", operation: "video" }).status).toBe("UNKNOWN");
  });
});
