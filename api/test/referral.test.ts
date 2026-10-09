import { describe, it, expect } from "vitest";
import { validateReferralPayload, matchReferrer } from "../src/modules/leads/referral";

describe("validateReferralPayload (native port of n8n workflow 07's Validate Referral)", () => {
  it("requires a referral code", () => {
    const r = validateReferralPayload({ new_user_email: "a@b.com" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("referral_code (or ref) is required");
  });

  it("requires a valid new-user email", () => {
    const r = validateReferralPayload({ referral_code: "WL-EKI-ADA-1234", new_user_email: "nope" });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain("new_user_email must be a valid email");
  });

  it("accepts ref as a shorthand for referral_code", () => {
    const r = validateReferralPayload({ ref: "wl-eki-ada-1234", new_user_email: "b@c.com" });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.referral.code).toBe("WL-EKI-ADA-1234");
  });

  it("defaults new_user_name to 'A friend'", () => {
    const r = validateReferralPayload({ referral_code: "WL-EKI-ADA-1234", new_user_email: "b@c.com" });
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.referral.newName).toBe("A friend");
  });
});

describe("matchReferrer (native port of n8n's Match Referrer)", () => {
  it("is unmatched when no referrer has that code", () => {
    expect(matchReferrer(null, false)).toEqual({ result: "unmatched", message: "Referral code not found; nothing credited." });
  });

  it("is a duplicate when this email was already credited", () => {
    expect(matchReferrer({ referralsCount: 2 }, true)).toEqual({ result: "duplicate", message: "This referral was already recorded." });
  });

  it("credits with no milestone below the thresholds", () => {
    expect(matchReferrer({ referralsCount: 1 }, false)).toEqual({ result: "credited", newCount: 2, milestone: "none" });
  });

  it("hits the VIP Access milestone on the 3rd referral", () => {
    expect(matchReferrer({ referralsCount: 2 }, false)).toEqual({ result: "credited", newCount: 3, milestone: "VIP Access" });
  });

  it("hits the Free Escrow milestone on the 5th referral", () => {
    expect(matchReferrer({ referralsCount: 4 }, false)).toEqual({ result: "credited", newCount: 5, milestone: "Free Escrow" });
  });
});
