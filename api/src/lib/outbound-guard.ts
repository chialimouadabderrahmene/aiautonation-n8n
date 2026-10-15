import { prisma } from "./prisma";

// Identical copy lives in worker/src/lib/outbound-guard.ts — keep byte-for-byte in sync
// (enforced by test/parity.test.ts). Every customer-facing external send goes through
// assertOutboundAllowed(): once at enqueue time and again immediately before the send.

/** Every operation that puts content in front of a customer or the public. Team-only
 * Telegram alerts (approval requests, failure notices) are deliberately NOT here: they are
 * internal diagnostics and must keep working while the stop is on. */
export const OUTBOUND_KINDS = [
  "social_publish",
  "video_publish",
  "carousel_publish",
  "whatsapp_send",
  "email_send",
] as const;
export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

export type OutboundPhase = "enqueue" | "execute";

export class OutboundBlockedError extends Error {
  readonly name = "OutboundBlockedError";
  readonly reason: "emergency_stop" | "state_unavailable";
  constructor(readonly kind: OutboundKind, readonly phase: OutboundPhase, reason: "emergency_stop" | "state_unavailable" = "emergency_stop") {
    super(
      reason === "emergency_stop"
        ? `Outbound ${kind} blocked at ${phase}: the emergency stop is active (Settings → Automation safety)`
        : `Outbound ${kind} blocked at ${phase}: emergency-stop state could not be read, so nothing is sent (fail closed)`,
    );
    this.reason = reason;
  }
}

export interface EmergencyStopState {
  active: boolean;
  changedAt: string | null;
  changedBy: string | null;
}

export const EMERGENCY_STOP_KEY = "autopilotStop";
export const EMERGENCY_STOP_META_KEY = "_emergencyStopChange";

/** Reads the stop straight from Postgres on every call — never cached — so a stop activated
 * a moment ago is honoured by the very next check. */
export async function getEmergencyStopState(): Promise<EmergencyStopState> {
  const [flag, meta] = await Promise.all([
    prisma.setting.findUnique({ where: { key: EMERGENCY_STOP_KEY } }),
    prisma.setting.findUnique({ where: { key: EMERGENCY_STOP_META_KEY } }),
  ]);
  const m = (meta?.value ?? {}) as { at?: string; by?: string };
  return { active: flag?.value === true, changedAt: m.at ?? null, changedBy: m.by ?? null };
}

/** Throws OutboundBlockedError when the stop is active or the state cannot be read. */
export async function assertOutboundAllowed(kind: OutboundKind, phase: OutboundPhase): Promise<void> {
  let state: EmergencyStopState;
  try {
    state = await getEmergencyStopState();
  } catch {
    throw new OutboundBlockedError(kind, phase, "state_unavailable");
  }
  if (state.active) throw new OutboundBlockedError(kind, phase, "emergency_stop");
}

/** True for errors that mean "do not retry, this was deliberately stopped". */
export function isOutboundBlocked(err: unknown): err is OutboundBlockedError {
  return err instanceof OutboundBlockedError;
}

/** For senders that return results instead of throwing: null when the send may proceed,
 * otherwise an honest `emergency_stop` result that callers record as skipped, never retried. */
export async function outboundStopResult(kind: OutboundKind, phase: OutboundPhase = "execute"): Promise<{ ok: false; reason: "emergency_stop"; message: string } | null> {
  try {
    await assertOutboundAllowed(kind, phase);
    return null;
  } catch (err) {
    if (isOutboundBlocked(err)) return { ok: false, reason: "emergency_stop", message: err.message };
    throw err;
  }
}
