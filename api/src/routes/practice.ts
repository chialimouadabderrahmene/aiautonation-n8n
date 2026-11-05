import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { emitEvent } from "../modules/engine/outbox";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { isPracticeMode, PRACTICE_PHONE_PREFIX, practiceMessageId } from "../lib/practice";
import { clearPracticeData, loadSamples } from "../modules/practice/samples";
import { getSetupSteps } from "../modules/practice/setup";

export const practiceRouter = Router();

const actor = (req: AuthedRequest) => req.admin?.email ?? "unknown";

const setSetting = (key: string, value: boolean) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

/** Sends a pretend inbound WhatsApp message through the same event the real webhook emits. */
const messageSchema = z.object({
  phone: z.string().regex(/^\d{6,15}$/).optional(),
  name: z.string().trim().max(60).optional(),
  text: z.string().trim().min(1).max(500),
});

practiceRouter.post("/message", async (req: AuthedRequest, res) => {
  if (!(await isPracticeMode())) return res.status(409).json({ message: "Pretend messages only work in Practice mode." });
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Type a message first." });
  const funnel = await prisma.engineWorkflow.findUnique({ where: { key: "whatsapp-lead-funnel" }, select: { enabled: true } });
  if (!funnel?.enabled) return res.status(409).json({ message: "Nobody is answering yet. Switch on the Welcome every new lead autopilot first.", needsAutopilot: "welcome-leads" });

  const phone = parsed.data.phone ?? `${PRACTICE_PHONE_PREFIX}${String(Math.floor(Math.random() * 800) + 200)}`;
  if (!phone.startsWith(PRACTICE_PHONE_PREFIX)) return res.status(400).json({ message: "Practice messages can only use sample numbers." });
  const messageId = practiceMessageId("inbound");
  const message = { phone, messageId, timestamp: new Date().toISOString(), type: "text", text: parsed.data.text, senderName: parsed.data.name ?? "Sample lead", waId: phone };
  await prisma.$transaction((tx) => emitEvent(tx, "whatsapp.message_received", message, messageId));
  await recordAudit(actor(req), "practice.message", "EngineLead", phone);
  res.status(202).json({ phone, messageId });
});

practiceRouter.post("/samples", async (req: AuthedRequest, res) => {
  if (!(await isPracticeMode())) return res.status(409).json({ message: "Sample data can only be added in Practice mode." });
  await loadSamples();
  await recordAudit(actor(req), "practice.samples_loaded", "Setting", "practiceMode");
  res.json({ ok: true });
});

practiceRouter.post("/reset", async (req: AuthedRequest, res) => {
  if (!(await isPracticeMode())) return res.status(409).json({ message: "Reset only works in Practice mode." });
  const removed = await clearPracticeData();
  await loadSamples();
  await recordAudit(actor(req), "practice.reset", "Setting", "practiceMode", removed);
  res.json({ ok: true, removed });
});

const goLiveSchema = z.object({ confirm: z.literal(true), postAfterApproval: z.boolean().default(true) });

/**
 * Leaving practice. Practice content is deleted so nothing simulated can ever be published for
 * real, and every autopilot is switched off so nothing turned on while practising starts
 * messaging real people. The team switches each one back on deliberately.
 */
practiceRouter.post("/go-live", async (req: AuthedRequest, res) => {
  if (req.admin?.role !== "OWNER") return res.status(403).json({ message: "Only an owner can take Eki live." });
  const parsed = goLiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Please confirm first." });
  const setup = await getSetupSteps();
  if (!setup.canGoLive) {
    const missing = setup.steps.filter((s) => s.required && !s.done).map((s) => s.title);
    return res.status(409).json({ message: `Finish these first: ${missing.join(", ")}.`, missing });
  }
  const removed = await clearPracticeData();
  await prisma.engineWorkflow.updateMany({ data: { enabled: false } });
  await prisma.engineScheduledTrigger.updateMany({ data: { enabled: false } });
  // Inbound signup webhooks stay reachable: turning them off would silently drop real people.
  await prisma.engineWorkflow.updateMany({ where: { key: { in: ["lead-capture-webhook", "waitlist-management", "referral-campaign", "feedback-collection"] } }, data: { enabled: true } });
  await setSetting("autopilotSocialPosting", parsed.data.postAfterApproval);
  await setSetting("practiceMode", false);
  await recordAudit(actor(req), "practice.went_live", "Setting", "practiceMode", { removed, postAfterApproval: parsed.data.postAfterApproval });
  res.json({ ok: true, removed });
});

practiceRouter.post("/enter", async (req: AuthedRequest, res) => {
  if (req.admin?.role !== "OWNER") return res.status(403).json({ message: "Only an owner can switch back to Practice mode." });
  await setSetting("practiceMode", true);
  await loadSamples();
  await recordAudit(actor(req), "practice.entered", "Setting", "practiceMode");
  res.json({ ok: true });
});
