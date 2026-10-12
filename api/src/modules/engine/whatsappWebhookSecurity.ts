import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";

/**
 * Meta's documented WhatsApp Cloud API webhook security — the two mechanisms this provider
 * actually specifies (never guessed, never invented):
 *
 * 1. GET verification handshake (one-time, when the webhook URL is configured in the Meta
 *    dashboard): the request carries `hub.mode=subscribe`, `hub.verify_token` and
 *    `hub.challenge` as query params. Respond 200 with the raw `hub.challenge` value as the
 *    body if `hub.verify_token` matches the token configured in Meta → WhatsApp →
 *    Configuration. Otherwise 403.
 *    https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 *
 * 2. POST signature (every delivery): header `X-Hub-Signature-256: sha256=<hex>`, where <hex>
 *    is HMAC-SHA256 of the RAW request body bytes (not the re-serialized/parsed JSON — a
 *    parsed-then-reserialized body can differ byte-for-byte from what Meta signed), keyed with
 *    the app secret. Verified with a constant-time comparison. Fails closed: if the app secret
 *    is not configured, every signature is treated as invalid (this is a security control, not
 *    a feature to skip when "not set up yet").
 *    https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 */

export async function verifyHandshake(query: Record<string, unknown>): Promise<{ ok: true; challenge: string } | { ok: false }> {
  const mode = String(query["hub.mode"] ?? "");
  const token = String(query["hub.verify_token"] ?? "");
  const challenge = String(query["hub.challenge"] ?? "");
  const v = await getProviderValues("whatsapp");
  const expected = v?.verifyToken ?? "";
  if (expected && mode === "subscribe" && constantTimeEqual(token, expected)) return { ok: true, challenge };
  return { ok: false };
}

export interface SignatureCheck {
  ok: boolean;
  /** Only set when ok=false, for logging/audit — never includes the secret or the raw signature value. */
  reason?: "not_configured" | "missing_header" | "mismatch";
}

/**
 * Verifies X-Hub-Signature-256 against the RAW request body. `rawBody` must be the exact bytes
 * Meta sent (before any JSON parsing/re-serialization) — see this module's doc comment.
 */
export async function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): Promise<SignatureCheck> {
  const integration = await prisma.integration.findUnique({ where: { provider: "whatsapp" } });
  const v = await getProviderValues("whatsapp");
  const secret = v?.appSecret ?? "";
  // Fails closed: an unconfigured app secret is NEVER treated as "skip verification".
  if (integration?.status !== "CONNECTED" || !secret) return { ok: false, reason: "not_configured" };
  if (!signatureHeader) return { ok: false, reason: "missing_header" };
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!constantTimeEqual(signatureHeader, expected)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Constant-time string comparison (Buffer length must match before timingSafeEqual runs, so
 * compare lengths first — this leaks only length, which is not the secret). */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface ParsedWhatsAppMessage {
  phone: string;
  messageId: string;
  timestamp: string;
  type: string;
  text: string;
  senderName?: string;
  waId?: string;
}

/** Shape per Meta's documented webhook payload for an inbound message notification:
 * entry[0].changes[0].value.{messages,contacts}. Returns null for any other event type this
 * webhook receives (status/delivery-receipt updates, etc.) — those are valid, correctly-signed
 * deliveries with nothing for this workflow to act on, not malformed payloads. */
export function parseInboundMessage(body: unknown): ParsedWhatsAppMessage | null {
  const b = body as { entry?: { changes?: { value?: { messages?: unknown[]; contacts?: { profile?: { name?: string }; wa_id?: string }[] } }[] }[] } | null;
  const value = b?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0] as { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } } | undefined;
  if (!msg) return null;
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const contact = value?.contacts?.[0];
  const ts = Number.parseInt(String(msg.timestamp ?? ""), 10);
  return {
    phone: digits(msg.from),
    messageId: String(msg.id ?? ""),
    timestamp: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    type: String(msg.type ?? ""),
    text: msg.type === "text" ? String(msg.text?.body ?? "") : "",
    senderName: contact?.profile?.name,
    waId: digits(contact?.wa_id ?? msg.from),
  };
}
