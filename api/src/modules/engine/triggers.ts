import { z } from "zod";

/**
 * Typed, versioned event registry. Every EVENT-triggered workflow matches on
 * `eventType`; the payload is validated against the matching schema before any
 * workflow is ever considered — an unknown or malformed event type is rejected,
 * never silently "trusted" through to an action handler.
 */

export const EVENT_SCHEMAS = {
  "lead.captured": z.object({ phone: z.string().min(6), name: z.string().optional(), email: z.string().email().optional(), source: z.string().optional(), market: z.string().optional() }),
  "waitlist.signup": z.object({ email: z.string().email(), name: z.string().optional(), phone: z.string().optional() }),
  "referral.submitted": z.object({ referralCode: z.string().min(1), refereeEmail: z.string().email(), refereeName: z.string().optional() }),
  "feedback.submitted": z.object({ leadPhone: z.string().min(6), rating: z.number().int().min(1).max(5), comment: z.string().optional() }),
  "video.published": z.object({ videoJobId: z.string().min(1), target: z.string().min(1), externalUrl: z.string().optional() }),
  "vendor.trial_ending": z.object({ vendorId: z.string().min(1), daysRemaining: z.number().int() }),
  "report.weekly_due": z.object({ periodStart: z.string(), periodEnd: z.string() }),
} as const;

export type EngineEventType = keyof typeof EVENT_SCHEMAS;

export function isKnownEventType(eventType: string): eventType is EngineEventType {
  return eventType in EVENT_SCHEMAS;
}

export function validateEventPayload(eventType: string, payload: unknown): { ok: true; payload: unknown } | { ok: false; error: string } {
  if (!isKnownEventType(eventType)) return { ok: false, error: `Unknown event type "${eventType}" — add it to EVENT_SCHEMAS before emitting it.` };
  const schema = EVENT_SCHEMAS[eventType] as z.ZodType<unknown>;
  const result = schema.safeParse(payload);
  if (!result.success) return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, payload: result.data };
}
