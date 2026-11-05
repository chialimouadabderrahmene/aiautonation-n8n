import { describe, expect, it } from "vitest";
import { attributionEventSchema } from "../src/routes/attribution";

describe("attribution event contract", () => {
  it("accepts lead, UTM and vendor activation fields", () => {
    const result = attributionEventSchema.parse({ eventId: "evt-1", eventType: "vendor_activated", vendorId: "vendor-1", source: "instagram", medium: "social", campaignName: "launch", content: "reel-1" });
    expect(result.eventType).toBe("vendor_activated");
    expect(result.campaignName).toBe("launch");
  });
  it("accepts the Eki marketplace account-created payload", () => {
    const result = attributionEventSchema.parse({ eventId: "eki:user:user_1:registered", eventType: "registration", leadId: "user_1", source: "instagram", campaignName: "launch", occurredAt: "2026-10-21T23:32:44.891Z", metadata: { origin: "eki-marketplace", kind: "user_registered", userId: "user_1", role: "BUYER", country: "IT", signupMethod: "google", referred: true, emailVerified: false, isTest: false } });
    expect(result.eventType).toBe("registration");
    expect(result.metadata.kind).toBe("user_registered");
  });
  it("rejects unsupported event types", () => expect(() => attributionEventSchema.parse({ eventId: "evt-1", eventType: "unknown" })).toThrow());
});
