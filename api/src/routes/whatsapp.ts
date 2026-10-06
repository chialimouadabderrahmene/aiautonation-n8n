import { Router } from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { getWhatsAppConfig, sendWhatsAppText } from "../modules/whatsapp/cloud-api";
import { handleInboundMessage } from "../modules/whatsapp/conversation";
import { enqueueWhatsAppNurtureRun } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { logger } from "../lib/logger";

// Generous but bounded: real traffic from Meta is one webhook call per
// inbound message, never a burst; this exists to cap abuse of a public,
// unauthenticated-until-signature-checked endpoint, not to throttle Meta.
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

export const whatsappRouter = Router(); // admin-facing: contacts/listings
/** Public — Meta calls this directly; GET is the subscription challenge, POST is signed. */
export const whatsappPublicRouter = Router();

function verifySignature(rawBody: Buffer | undefined, signatureHeader: unknown, appSecret: string): boolean {
  if (!rawBody || typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = signatureHeader.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Meta's webhook subscription verification (one-time, on save in the App dashboard). */
whatsappPublicRouter.get("/webhook", async (req, res) => {
  const config = await getWhatsAppConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!config || mode !== "subscribe" || token !== config.verifyToken) return res.status(403).send("Forbidden");
  res.status(200).send(String(challenge ?? ""));
});

whatsappPublicRouter.post("/webhook", webhookLimiter, async (req, res) => {
  const config = await getWhatsAppConfig();
  if (!config) return res.status(503).json({ message: "WhatsApp is not configured" });
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!verifySignature(rawBody, req.headers["x-hub-signature-256"], config.appSecret)) return res.status(403).json({ message: "Invalid signature" });
  res.status(200).json({ ok: true }); // acknowledge immediately — Meta retries on anything else, same pattern as the Telegram webhook.

  try {
    const body = req.body as {
      entry?: { changes?: { value?: { messages?: { id?: string; from: string; type: string; text?: { body: string } }[] } }[] }[];
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text" || !message.text?.body) continue; // v1: text replies only, same scope as the ported workflow 13
          const { reply, duplicate } = await handleInboundMessage(message.from, message.text.body, "whatsapp", message.id);
          if (duplicate) {
            logger.info({ messageId: message.id }, "[whatsapp] duplicate webhook delivery, skipped");
            continue;
          }
          if (reply) await sendWhatsAppText(config, message.from, reply).catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[whatsapp] reply send failed"));
        }
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[whatsapp] webhook handling failed");
  }
});

/** Manual run of the nurture sweep (native port of n8n workflow 19's Manual Run node) — the worker's own daily 08:00 UTC schedule covers the automatic path. */
whatsappRouter.post("/nurture/run", async (req: AuthedRequest, res) => {
  await enqueueWhatsAppNurtureRun();
  await recordAudit(req.admin?.email ?? "unknown", "whatsapp.nurture_run_requested", "WhatsAppContact", "bulk");
  res.status(202).json({ ok: true, message: "Queued — the worker runs the nurture sweep next" });
});

whatsappRouter.get("/contacts", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await prisma.whatsAppContact.findMany({ where: status ? { status: status as never } : undefined, orderBy: { updatedAt: "desc" }, take: 200 }));
});

whatsappRouter.get("/contacts/:id", async (req, res) => {
  const contact = await prisma.whatsAppContact.findUnique({
    where: { id: String(req.params.id) },
    include: { messages: { orderBy: { createdAt: "asc" } }, listings: { orderBy: { createdAt: "desc" } } },
  });
  if (!contact) return res.status(404).json({ message: "Not found" });
  res.json(contact);
});

whatsappRouter.get("/listings", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await prisma.productListing.findMany({ where: status ? { status } : undefined, include: { contact: true }, orderBy: { updatedAt: "desc" }, take: 200 }));
});
