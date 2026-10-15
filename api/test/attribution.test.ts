import { describe, expect, it } from "vitest";
import { attributionEventSchema } from "../src/routes/attribution";

describe("attribution event contract", () => {
  it("accepts lead, UTM and vendor activation fields", () => {
    const result = attributionEventSchema.parse({ eventId: "evt-1", eventType: "vendor_activated", vendorId: "vendor-1", source: "instagram", medium: "social", campaignName: "launch", content: "reel-1" });
    expect(result.eventType).toBe("vendor_activated");
    expect(result.campaignName).toBe("launch");
  });
  it("rejects unsupported event types", () => expect(() => attributionEventSchema.parse({ eventId: "evt-1", eventType: "unknown" })).toThrow());
});
