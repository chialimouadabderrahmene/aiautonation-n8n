/**
 * Waitlist signups — native port of n8n workflow 04 ("Waitlist
 * Management"). Its own model (`WaitlistEntry`), not WhatsAppContact: a
 * signup may give only an email (no phone), and it tracks its own referral
 * program (position, code, referral count) with no equivalent on a
 * contact. Reuses the same shared-secret auth as /api/leads/capture (P6)
 * rather than a second key — same trust boundary, same risk.
 *
 * Not ported: n8n's immediate WhatsApp/email confirmation send. The
 * synchronous HTTP response already carries position + referral code,
 * which is the value those confirmations existed to deliver; actually
 * sending them is the same out-of-scope WhatsApp-template/Resend work
 * noted in modules/leads/capture.ts.
 */
export interface WaitlistSignup {
  name: string;
  email: string;
  whatsapp: string;
  consent: boolean;
  userType: "Vendor" | "Buyer";
}

export type WaitlistValidationResult = { valid: true; signup: WaitlistSignup } | { valid: false; errors: string[] };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pure — mirrors n8n's "Validate Signup" node exactly. */
export function validateWaitlistSignup(body: Record<string, unknown>): WaitlistValidationResult {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const digits = (v: unknown) => str(v).replace(/\D/g, "");
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const whatsapp = digits(body.whatsapp ?? body.phone);

  const errors: string[] = [];
  if (!name) errors.push("name is required");
  if (!email && !whatsapp) errors.push("email or whatsapp is required");
  if (email && !EMAIL_RE.test(email)) errors.push("email is invalid");
  if (whatsapp && (whatsapp.length < 8 || whatsapp.length > 15)) errors.push("whatsapp must be 8-15 digits (international format, digits only)");
  if (errors.length) return { valid: false, errors };

  const consent = body.consent === true || ["true", "yes", "1"].includes(str(body.consent).toLowerCase());
  const userType: WaitlistSignup["userType"] = str(body.user_type).toLowerCase() === "buyer" ? "Buyer" : "Vendor";
  return { valid: true, signup: { name, email, whatsapp, consent, userType } };
}

/** A random, unique-enough code; the DB's unique constraint on referralCode is the real guarantee. */
function generateReferralCode(name: string): string {
  const base = (name.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "EKI").padEnd(3, "X");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WL-EKI-${base}-${suffix}`;
}

export interface WaitlistRecord {
  email: string | null;
  whatsapp: string | null;
  name: string;
  position: number;
  referralCode: string;
  userType: string;
  consent: boolean;
}

/** Pure — mirrors n8n's "Dedupe And Build". `existingCount` is the table size (next position); `match` is an already-found duplicate, if any. */
export function buildWaitlistRecord(signup: WaitlistSignup, existingCount: number, match: { position: number; referralCode: string } | null): { isDuplicate: true; position: number; referralCode: string } | { isDuplicate: false; record: WaitlistRecord } {
  if (match) return { isDuplicate: true, position: match.position, referralCode: match.referralCode };
  return {
    isDuplicate: false,
    record: {
      email: signup.email || null,
      whatsapp: signup.whatsapp || null,
      name: signup.name,
      position: existingCount + 1,
      referralCode: generateReferralCode(signup.name),
      userType: signup.userType,
      consent: signup.consent,
    },
  };
}
