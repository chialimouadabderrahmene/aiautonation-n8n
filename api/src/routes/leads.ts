import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { getSetting } from "../modules/settings/schema";
import { secretsEqual, notifyAdmin } from "../modules/telegram/telegram";
import { validateLeadPayload, mergeLeadUpdate } from "../modules/leads/capture";
import { recordAudit } from "../modules/audit/audit";

/** Public — external systems only, gated by the leadCaptureApiKey setting (never admin-session auth). */
export const leadsPublicRouter = Router();

// Bounded the same way the other public webhooks are: real external
// traffic here is a handful of form submissions, never a burst.
const leadCaptureLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

leadsPublicRouter.post("/capture", leadCaptureLimiter, async (req, res) => {
  const configured = await getSetting<string>("leadCaptureApiKey");
  if (!configured) return res.status(503).json({ message: "Lead capture is not configured" });
  const given = req.headers["x-api-key"];
  if (typeof given !== "string" || !secretsEqual(given, configured)) return res.status(401).json({ message: "Invalid API key" });

  const parsed = validateLeadPayload((req.body as Record<string, unknown>) ?? {});
  if (!parsed.valid) return res.status(400).json({ message: parsed.errors.join("; ") });
  const { incoming } = parsed;

  // Storage only supports phone-keyed contacts (see modules/leads/capture.ts) —
  // an email-only lead still gets the team alert below, just isn't persisted.
  let isDuplicate = false;
  if (incoming.phone) {
    const existing = await prisma.whatsAppContact.findUnique({ where: { phone: incoming.phone } });
    const { update, isDuplicate: dup } = mergeLeadUpdate(existing, incoming, new Date());
    isDuplicate = dup;
    await prisma.whatsAppContact.upsert({
      where: { phone: incoming.phone },
      update,
      create: { phone: incoming.phone, name: update.name, role: update.role, source: update.source, optIn: update.optIn, optInAt: update.optInAt },
    });
  }

  await recordAudit("lead-capture-api", "lead.captured", "WhatsAppContact", incoming.phone || incoming.email, { source: incoming.source, userType: incoming.userType, isDuplicate });
  await notifyAdmin(
    `New lead captured\nName: ${incoming.name}\nPhone: ${incoming.phone || "-"}\nEmail: ${incoming.email || "-"}\nType: ${incoming.userType}\nSource: ${incoming.source}\nIntent: ${incoming.intentLevel}\nOpt-in: ${incoming.consent ? "yes" : "no"}${isDuplicate ? "\n(existing lead updated)" : ""}${!incoming.phone ? "\n(no phone — not stored as a contact, team alert only)" : ""}`,
  );

  res.status(200).json({ status: "ok", duplicate: isDuplicate, stored: Boolean(incoming.phone) });
});
