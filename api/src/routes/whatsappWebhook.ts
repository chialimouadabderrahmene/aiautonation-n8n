import { Router, raw } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { recordAudit } from "../modules/audit/audit";
import { verifyHandshake, verifySignature, parseInboundMessage } from "../modules/engine/whatsappWebhookSecurity";
import { emitEvent } from "../modules/engine/outbox";

/**
 * The native replacement for n8n 13-whatsapp-lead-funnel.json's two webhook nodes ("WA Verify
 * GET" + "WA Incoming POST"). Mounted BEFORE the global express.json() body parser (see
 * app.ts) — signature verification needs the RAW request bytes, which express.json() would
 * already have consumed and reserialized by the time any later route saw them. This is why it
 * is its own router rather than another entry in the generic /api/hooks/:workflowKey contract
 * (routes/hooks.ts), which assumes a parsed JSON body and has no raw-body or GET-handshake
 * support — a real, documented difference between this provider's webhook contract and the
 * others', not an arbitrary inconsistency.
 */
export const whatsappWebhookRouter = Router();

// Meta can retry deliveries fairly aggressively; generous but still bounded.
const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

whatsappWebhookRouter.get("/whatsapp", limiter, async (req, res) => {
  const result = await verifyHandshake(req.query as Record<string, unknown>);
  if (!result.ok) {
    await recordAudit("webhook:whatsapp", "engine.webhook.whatsapp.verify_failed", undefined, undefined, { mode: req.query["hub.mode"] });
    return res.status(403).send("Forbidden");
  }
  res.status(200).type("text/plain").send(result.challenge);
});

whatsappWebhookRouter.post("/whatsapp", limiter, raw({ type: () => true, limit: "1mb" }), async (req, res) => {
  const rawBody = req.body as Buffer;
  const signature = req.header("x-hub-signature-256");
  const check = await verifySignature(rawBody, signature);
  if (!check.ok) {
    logger.warn({ reason: check.reason }, "[whatsapp-webhook] rejected — invalid signature");
    await recordAudit("webhook:whatsapp", "engine.webhook.whatsapp.invalid_signature", undefined, undefined, { reason: check.reason });
    return res.status(401).json({ status: "invalid_signature" });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    // Correctly signed but not valid JSON — Meta will not send this in practice, but fail
    // safe rather than let a parse error surface as an unhandled exception.
    return res.status(400).json({ status: "malformed_body" });
  }

  // ACK immediately once the signature is verified (Meta's own guidance: respond fast, or it
  // backs off and retries) — business processing continues after the response is sent, exactly
  // mirroring the n8n original's "ACK 200" firing before "Parse Message" runs.
  res.status(200).json({ status: "received" });

  const message = parseInboundMessage(body);
  if (!message) return; // a valid, correctly-signed delivery with nothing to act on (e.g. a status/read-receipt webhook)

  try {
    await prisma.$transaction((tx) => emitEvent(tx, "whatsapp.message_received", message, message.messageId));
  } catch (err) {
    // The response is already sent; nothing left to do but log loudly. A failure here means
    // Meta's retry (it WILL retry on anything but a 2xx from the initial POST, which already
    // happened) will simply re-deliver the same message_id, which emitEvent dedupes on anyway.
    logger.error({ err: err instanceof Error ? err.message : String(err), messageId: message.messageId }, "[whatsapp-webhook] failed to enqueue inbound message");
  }
});
