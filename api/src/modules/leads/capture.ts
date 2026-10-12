/**
 * Generic external lead capture — native port of n8n workflow 03 ("Lead
 * Capture Webhook"). Lets a landing page / ad form / other external system
 * submit a lead without going through WhatsApp first.
 *
 * Scope note: this system's only lead/contact model is `WhatsAppContact`,
 * which is phone-keyed (its own invariant — it's the record WhatsApp
 * messaging to that number is built on). n8n's version allowed an
 * email-only lead (no phone); this port keeps that same validation rule
 * (phone OR email) but only *persists* a contact when a phone is present —
 * an email-only submission still reaches the team via the same Telegram
 * alert, it just isn't stored as a contact. This is a storage limitation
 * of reusing the existing model, not a new business rule: every other lead
 * concept in this codebase (nurture, conversation state) is phone-first.
 *
 * Also deliberately not ported: n8n's immediate "send WELCOME_D1 template"
 * step. That would duplicate worker/src/pipeline/whatsapp-nurture.ts's
 * template-sending logic on the api side for one call site — out of scope
 * for this pass. The lead is still captured and alerted; welcoming it by
 * WhatsApp is a (now very narrow) follow-up.
 */
import { WhatsAppContact } from "@prisma/client";

export interface LeadInput {
  phone: string;
  email: string;
  name: string;
  consent: boolean;
  userType: "vendor" | "buyer" | "unknown";
  source: string;
  intentLevel: string;
  country: string;
}

export type ValidationResult = { valid: true; incoming: LeadInput } | { valid: false; errors: string[] };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Pure — mirrors n8n workflow 03's "Validate Lead" node exactly. */
export function validateLeadPayload(body: Record<string, unknown>): ValidationResult {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
  const digits = (v: unknown) => str(v).replace(/\D/g, "");
  const phone = digits(body.phone ?? body.wa_id ?? body.whatsapp);
  const email = str(body.email).toLowerCase();
  const name = str(body.name ?? body.username);

  const errors: string[] = [];
  if (!phone && !email) errors.push("phone or email is required");
  if (phone && (phone.length < 8 || phone.length > 15)) errors.push("phone must be 8-15 digits (international format, digits only)");
  if (email && !EMAIL_RE.test(email)) errors.push("email is invalid");
  if (!name) errors.push("name is required");
  if (errors.length) return { valid: false, errors };

  const consent = body.consent === true || ["true", "yes", "1"].includes(str(body.consent).toLowerCase());
  const ut = str(body.user_type).toLowerCase();
  return {
    valid: true,
    incoming: {
      phone,
      email,
      name,
      consent,
      userType: ut === "vendor" || ut === "buyer" ? ut : "unknown",
      source: str(body.source) || "web",
      intentLevel: str(body.intent_level).toLowerCase() || "low",
      country: str(body.country),
    },
  };
}

export interface LeadMergeResult {
  /** Fields to upsert onto WhatsAppContact — never overwrites an already-known role/name with "unknown"/blank. */
  update: { name: string; role?: string; source: string; optIn: boolean; optInAt?: Date };
  isDuplicate: boolean;
}

/** Pure — mirrors n8n's "Merge Lead" (minus the WhatsApp welcome-template decision; see module docstring). */
export function mergeLeadUpdate(existing: Pick<WhatsAppContact, "role" | "source" | "optIn" | "optInAt"> | null, incoming: LeadInput, now: Date): LeadMergeResult {
  const update: LeadMergeResult["update"] = {
    name: incoming.name,
    role: incoming.userType !== "unknown" ? incoming.userType : existing?.role ?? undefined,
    source: existing?.source || incoming.source,
    // A fresh, explicit consent (form checkbox) opts in. Not consenting on
    // THIS submission never revokes an already-true opt-in from before —
    // matches n8n's `else if (!existing.opt_in) opt_in = 'no'` exactly.
    optIn: incoming.consent || existing?.optIn === true,
  };
  if (incoming.consent && !existing?.optInAt) update.optInAt = now;
  return { update, isDuplicate: existing !== null };
}
