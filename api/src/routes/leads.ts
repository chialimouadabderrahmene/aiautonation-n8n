import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { getSetting } from "../modules/settings/schema";
import { secretsEqual, notifyAdmin } from "../modules/telegram/telegram";
import { validateLeadPayload, mergeLeadUpdate } from "../modules/leads/capture";
import { validateWaitlistSignup, buildWaitlistRecord } from "../modules/leads/waitlist";
import { validateReferralPayload, matchReferrer } from "../modules/leads/referral";
import { recordAudit } from "../modules/audit/audit";

/**
 * Public — external systems only, gated by the leadCaptureApiKey setting
 * (never admin-session auth).
 *
 * Server-to-server only: the shared secret must never be embedded in a
 * landing page's client-side JS (anyone viewing page source could read and
 * reuse it). The external system's own backend should hold the key and
 * call this endpoint itself — CORS is deliberately NOT opened for these
 * routes (same global `cors()` policy as the rest of the API), which is
 * correct, not a bug: a browser calling this directly would need the key
 * in client-side code either way.
 */
export const leadsPublicRouter = Router();

// Bounded the same way the other public webhooks are: real external
// traffic here is a handful of form submissions, never a burst.
const leadCaptureLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

async function requireIntakeKey(req: Request, res: Response, next: NextFunction) {
  const configured = await getSetting<string>("leadCaptureApiKey");
  if (!configured) {
    res.status(503).json({ message: "This endpoint is not configured" });
    return;
  }
  const given = req.headers["x-api-key"];
  if (typeof given !== "string" || !secretsEqual(given, configured)) {
    res.status(401).json({ message: "Invalid API key" });
    return;
  }
  next();
}

leadsPublicRouter.post("/capture", leadCaptureLimiter, requireIntakeKey, async (req, res) => {
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

leadsPublicRouter.post("/waitlist", leadCaptureLimiter, requireIntakeKey, async (req, res) => {
  const parsed = validateWaitlistSignup((req.body as Record<string, unknown>) ?? {});
  if (!parsed.valid) return res.status(400).json({ message: parsed.errors.join("; ") });
  const { signup } = parsed;

  const [match, existingCount] = await Promise.all([
    prisma.waitlistEntry.findFirst({
      where: { OR: [signup.email ? { email: signup.email } : undefined, signup.whatsapp ? { whatsapp: signup.whatsapp } : undefined].filter((c): c is NonNullable<typeof c> => Boolean(c)) },
      select: { position: true, referralCode: true },
    }),
    prisma.waitlistEntry.count(),
  ]);

  const result = buildWaitlistRecord(signup, existingCount, match);
  if (result.isDuplicate) {
    return res.status(200).json({ status: "already_registered", position: result.position, referralCode: result.referralCode, message: "You are already on the Eki waitlist." });
  }

  await prisma.waitlistEntry.create({ data: result.record });
  await recordAudit("lead-capture-api", "waitlist.joined", "WaitlistEntry", result.record.referralCode, { userType: result.record.userType, position: result.record.position });
  await notifyAdmin(`New waitlist signup (#${result.record.position})\nName: ${result.record.name}\nEmail: ${result.record.email || "-"}\nWhatsApp: ${result.record.whatsapp || "-"}\nType: ${result.record.userType}`);

  res.status(200).json({ status: "success", position: result.record.position, referralCode: result.record.referralCode, message: "Waitlist registration complete." });
});

leadsPublicRouter.post("/referral", leadCaptureLimiter, requireIntakeKey, async (req, res) => {
  const parsed = validateReferralPayload((req.body as Record<string, unknown>) ?? {});
  if (!parsed.valid) return res.status(400).json({ message: parsed.errors.join("; ") });
  const { referral } = parsed;

  const [referrer, alreadyReferred] = await Promise.all([
    prisma.waitlistEntry.findUnique({ where: { referralCode: referral.code }, select: { id: true, name: true, referralsCount: true } }),
    prisma.referral.findUnique({ where: { referredEmail: referral.newEmail }, select: { id: true } }),
  ]);
  const outcome = matchReferrer(referrer, Boolean(alreadyReferred));

  if (outcome.result !== "credited") {
    return res.status(200).json({ status: outcome.result === "unmatched" ? "completed" : "duplicate", message: outcome.message });
  }

  await prisma.$transaction([
    prisma.referral.create({ data: { referrerId: referrer!.id, referredEmail: referral.newEmail, referredName: referral.newName, milestoneReached: outcome.milestone } }),
    prisma.waitlistEntry.update({ where: { id: referrer!.id }, data: { referralsCount: outcome.newCount } }),
  ]);
  await recordAudit("lead-capture-api", "referral.credited", "WaitlistEntry", referrer!.id, { referredEmail: referral.newEmail, newCount: outcome.newCount, milestone: outcome.milestone });
  if (outcome.milestone !== "none") {
    await notifyAdmin(`Referral milestone: ${referrer!.name} just unlocked "${outcome.milestone}" (${outcome.newCount} referrals)`);
  }

  res.status(200).json({ status: "credited", referralsCount: outcome.newCount, milestone: outcome.milestone });
});
