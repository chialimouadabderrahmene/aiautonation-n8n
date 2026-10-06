/**
 * Referral crediting — native port of n8n workflow 07 ("Referral Campaign
 * Tracker"). The referrer is always a `WaitlistEntry` (the only place a
 * referral code exists in this app — see modules/leads/waitlist.ts).
 * Milestone thresholds (3rd referral -> "VIP Access", 5th -> "Free
 * Escrow") are n8n's own numbers, not invented here.
 *
 * Not ported: n8n's milestone reward email. Same out-of-scope reasoning
 * as capture.ts/waitlist.ts — no native Resend sender exists yet.
 */
export interface ReferralSubmission {
  code: string;
  newEmail: string;
  newName: string;
}

export type ReferralValidationResult = { valid: true; referral: ReferralSubmission } | { valid: false; errors: string[] };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pure — mirrors n8n's "Validate Referral" node exactly. */
export function validateReferralPayload(body: Record<string, unknown>): ReferralValidationResult {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const code = str(body.referral_code ?? body.ref).toUpperCase();
  const newEmail = str(body.new_user_email ?? body.new_email).toLowerCase();
  const newName = str(body.new_user_name ?? body.new_name) || "A friend";

  const errors: string[] = [];
  if (!code) errors.push("referral_code (or ref) is required");
  if (!newEmail || !EMAIL_RE.test(newEmail)) errors.push("new_user_email must be a valid email");
  if (errors.length) return { valid: false, errors };

  return { valid: true, referral: { code, newEmail, newName } };
}

export type ReferralOutcome =
  | { result: "unmatched"; message: string }
  | { result: "duplicate"; message: string }
  | { result: "credited"; newCount: number; milestone: "none" | "VIP Access" | "Free Escrow" };

/** Pure — mirrors n8n's "Match Referrer": unmatched code, already-credited email, or a credited referral with its milestone (if any). */
export function matchReferrer(referrer: { referralsCount: number } | null, alreadyReferred: boolean): ReferralOutcome {
  if (!referrer) return { result: "unmatched", message: "Referral code not found; nothing credited." };
  if (alreadyReferred) return { result: "duplicate", message: "This referral was already recorded." };
  const newCount = referrer.referralsCount + 1;
  const milestone = newCount === 3 ? "VIP Access" : newCount === 5 ? "Free Escrow" : "none";
  return { result: "credited", newCount, milestone };
}
