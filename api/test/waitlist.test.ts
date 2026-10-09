import { describe, it, expect } from "vitest";
import { validateWaitlistSignup, buildWaitlistRecord } from "../src/modules/leads/waitlist";

describe("validateWaitlistSignup (native port of n8n workflow 04's Validate Signup)", () => {
  it("requires a name", () => {
    const r = validateWaitlistSignup({ email: "a@b.com" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("name is required");
  });

  it("requires email or whatsapp", () => {
    const r = validateWaitlistSignup({ name: "Ada" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("email or whatsapp is required");
  });

  it("rejects an invalid email", () => {
    const r = validateWaitlistSignup({ name: "Ada", email: "nope" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("email is invalid");
  });

  it("rejects a whatsapp number outside 8-15 digits", () => {
    const r = validateWaitlistSignup({ name: "Ada", whatsapp: "123" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.some((e) => e.includes("8-15 digits"))).toBe(true);
  });

  it("accepts a valid whatsapp-only signup and normalizes userType", () => {
    const r = validateWaitlistSignup({ name: "Ada", whatsapp: "+1 555 123 4567", user_type: "buyer", consent: true });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.signup).toEqual({ name: "Ada", email: "", whatsapp: "15551234567", consent: true, userType: "Buyer" });
  });

  it("defaults userType to Vendor for anything not 'buyer'", () => {
    const r = validateWaitlistSignup({ name: "Ada", email: "a@b.com" });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.signup.userType).toBe("Vendor");
  });
});

describe("buildWaitlistRecord (native port of n8n's Dedupe And Build)", () => {
  const signup = { name: "Ada", email: "ada@example.com", whatsapp: "", consent: true, userType: "Vendor" as const };

  it("returns the existing position/code for a duplicate, without building a new record", () => {
    const r = buildWaitlistRecord(signup, 10, { position: 3, referralCode: "WL-EKI-ADA-1234" });
    expect(r).toEqual({ isDuplicate: true, position: 3, referralCode: "WL-EKI-ADA-1234" });
  });

  it("assigns the next position (count + 1) for a new signup", () => {
    const r = buildWaitlistRecord(signup, 10, null);
    expect(r.isDuplicate).toBe(false);
    if (!r.isDuplicate) expect(r.record.position).toBe(11);
  });

  it("generates a referral code in the WL-EKI-<3 letters>-<4 chars> shape", () => {
    const r = buildWaitlistRecord(signup, 0, null);
    if (!r.isDuplicate) expect(r.record.referralCode).toMatch(/^WL-EKI-[A-Z]{3}-[A-Z0-9]{4}$/);
  });

  it("stores null (not empty string) for a channel that wasn't given", () => {
    const r = buildWaitlistRecord({ ...signup, email: "" , whatsapp: "15551234567" }, 0, null);
    if (!r.isDuplicate) expect(r.record.email).toBeNull();
  });
});
