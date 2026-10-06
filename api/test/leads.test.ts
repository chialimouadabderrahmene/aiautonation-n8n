import { describe, it, expect } from "vitest";
import { validateLeadPayload, mergeLeadUpdate } from "../src/modules/leads/capture";

describe("validateLeadPayload (native port of n8n workflow 03's Validate Lead)", () => {
  it("requires a name", () => {
    const r = validateLeadPayload({ phone: "15551234567" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("name is required");
  });

  it("requires phone or email", () => {
    const r = validateLeadPayload({ name: "Ada" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("phone or email is required");
  });

  it("rejects a phone outside 8-15 digits", () => {
    const r = validateLeadPayload({ name: "Ada", phone: "123" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.includes("8-15 digits"))).toBe(true);
  });

  it("rejects an invalid email", () => {
    const r = validateLeadPayload({ name: "Ada", email: "not-an-email" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("email is invalid");
  });

  it("accepts a valid phone-only submission and normalizes fields", () => {
    const r = validateLeadPayload({ name: " Ada ", phone: "+1 (555) 123-4567", user_type: "VENDOR", consent: true });
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.incoming).toMatchObject({ name: "Ada", phone: "15551234567", userType: "vendor", consent: true, source: "web", intentLevel: "low" });
    }
  });

  it("falls back userType to 'unknown' for anything not vendor/buyer", () => {
    const r = validateLeadPayload({ name: "Ada", phone: "15551234567", user_type: "curious" });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.incoming.userType).toBe("unknown");
  });
});

describe("mergeLeadUpdate (native port of n8n's Merge Lead, minus the WA-template decision)", () => {
  const incoming = { phone: "15551234567", email: "", name: "Ada", consent: true, userType: "vendor" as const, source: "web", intentLevel: "low", country: "" };
  const now = new Date("2026-01-01T00:00:00Z");

  it("is not a duplicate for a brand-new contact", () => {
    const { isDuplicate } = mergeLeadUpdate(null, incoming, now);
    expect(isDuplicate).toBe(false);
  });

  it("sets optInAt only the first time consent is given", () => {
    const { update } = mergeLeadUpdate(null, incoming, now);
    expect(update.optIn).toBe(true);
    expect(update.optInAt).toEqual(now);
  });

  it("never re-stamps optInAt once already set", () => {
    const existing = { role: "vendor", source: "web", optIn: true, optInAt: new Date("2025-06-01T00:00:00Z") };
    const { update } = mergeLeadUpdate(existing, incoming, now);
    expect(update.optInAt).toBeUndefined();
  });

  it("never revokes an existing opt-in when this submission has no consent", () => {
    const existing = { role: "vendor", source: "web", optIn: true, optInAt: new Date("2025-06-01T00:00:00Z") };
    const noConsent = { ...incoming, consent: false };
    const { update } = mergeLeadUpdate(existing, noConsent, now);
    expect(update.optIn).toBe(true);
  });

  it("keeps the known role when a later submission says 'unknown'", () => {
    const existing = { role: "vendor", source: "web", optIn: true, optInAt: now };
    const unknownType = { ...incoming, userType: "unknown" as const };
    const { update } = mergeLeadUpdate(existing, unknownType, now);
    expect(update.role).toBe("vendor");
  });

  it("marks an existing contact as a duplicate", () => {
    const existing = { role: "vendor", source: "web", optIn: true, optInAt: now };
    const { isDuplicate } = mergeLeadUpdate(existing, incoming, now);
    expect(isDuplicate).toBe(true);
  });
});
