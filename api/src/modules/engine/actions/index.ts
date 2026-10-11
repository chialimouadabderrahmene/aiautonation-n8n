import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { sendTelegramMessage } from "../../telegram/telegram";
import { sendEmail } from "../../senders/resend";
import { sendWhatsAppTemplate } from "../../senders/whatsapp";
import { emitEvent } from "../outbox";
import type { EngineEventType } from "../triggers";
import { LeadStatus, ReferralStatus } from "@prisma/client";

/**
 * The action registry. Every action is: a Zod input schema (validated before the handler
 * ever runs), an idempotency contract, and a plain async handler that returns a JSON-
 * serialisable output (persisted on the step row) or throws (step fails → retry/dead-letter
 * per the execution's policy). Reuses existing domain services/senders — never writes to the
 * database or calls a provider by any other path, so every safeguard that service already
 * enforces (consent, approved-template-only WhatsApp, honest provider results) still applies.
 */

export interface ActionDefinition<I = unknown, O = unknown> {
  key: string;
  inputSchema: z.ZodType<I>;
  /** True: safe to call more than once with the same input (e.g. an upsert). False: the
   * executor will never re-invoke this handler for a step that already has a SUCCEEDED row. */
  idempotent: boolean;
  handler: (input: I) => Promise<O>;
}

function define<I, O>(def: ActionDefinition<I, O>): ActionDefinition<I, O> {
  return def;
}

const leadUpsert = define({
  key: "lead.upsert",
  idempotent: true,
  inputSchema: z.object({ phone: z.string().min(6), name: z.string().optional(), email: z.string().email().optional(), source: z.string().optional(), market: z.string().optional() }),
  async handler(input) {
    const existing = await prisma.engineLead.findUnique({ where: { phone: input.phone } });
    const lead = await prisma.engineLead.upsert({
      where: { phone: input.phone },
      update: { name: input.name ?? undefined, email: input.email ?? undefined, market: input.market ?? undefined },
      create: { phone: input.phone, name: input.name, email: input.email, source: input.source, market: input.market, status: LeadStatus.NEW },
    });
    return { leadId: lead.id, isNew: !existing, status: lead.status };
  },
});

const waitlistAdd = define({
  key: "waitlist.add",
  idempotent: true,
  inputSchema: z.object({ email: z.string().email(), name: z.string().optional(), phone: z.string().optional(), wantsEmail: z.boolean().default(true), wantsWhatsapp: z.boolean().default(false) }),
  async handler(input) {
    const existing = await prisma.engineWaitlistEntry.findUnique({ where: { email: input.email } });
    if (existing) return { entryId: existing.id, duplicate: true };
    const entry = await prisma.engineWaitlistEntry.create({ data: { email: input.email, name: input.name, phone: input.phone, wantsEmail: input.wantsEmail, wantsWhatsapp: input.wantsWhatsapp } });
    return { entryId: entry.id, duplicate: false };
  },
});

const referralRecord = define({
  key: "referral.record",
  idempotent: true,
  inputSchema: z.object({ referralCode: z.string().min(1), refereeEmail: z.string().email(), refereeName: z.string().optional() }),
  async handler(input) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.engineReferral.findUnique({ where: { referralCode_refereeEmail: { referralCode: input.referralCode, refereeEmail: input.refereeEmail } } });
      if (existing) return { referralId: existing.id, status: existing.status, referrerEmail: null as string | null };
      const code = await tx.engineReferralCode.findUnique({ where: { code: input.referralCode } });
      if (!code) {
        const referral = await tx.engineReferral.create({ data: { referralCode: input.referralCode, refereeEmail: input.refereeEmail, refereeName: input.refereeName, status: ReferralStatus.UNMATCHED } });
        return { referralId: referral.id, status: referral.status, referrerEmail: null as string | null };
      }
      const referral = await tx.engineReferral.create({ data: { codeId: code.id, referralCode: input.referralCode, refereeEmail: input.refereeEmail, refereeName: input.refereeName, status: ReferralStatus.MATCHED } });
      await tx.engineReferralCode.update({ where: { id: code.id }, data: { referralCount: { increment: 1 } } });
      return { referralId: referral.id, status: referral.status, referrerEmail: code.ownerEmail };
    });
  },
});

const feedbackRecord = define({
  key: "feedback.record",
  idempotent: true,
  inputSchema: z.object({ leadPhone: z.string().min(6), rating: z.number().int().min(1).max(5), comment: z.string().optional() }),
  async handler(input) {
    const row = await prisma.engineFeedbackRequest.upsert({
      where: { leadPhone: input.leadPhone },
      update: { status: "RESPONDED", respondedAt: new Date(), rating: input.rating, comment: input.comment },
      create: { leadPhone: input.leadPhone, status: "RESPONDED", respondedAt: new Date(), rating: input.rating, comment: input.comment },
    });
    return { requestId: row.id, negative: input.rating <= 2 };
  },
});

const notifyTelegram = define({
  key: "notify.telegram",
  idempotent: false, // sending a message twice is a real duplicate send, not a safe no-op
  inputSchema: z.object({ chatId: z.string().min(1), text: z.string().min(1).max(4000) }),
  async handler(input) {
    const result = await sendTelegramMessage(input.chatId, input.text);
    return { messageId: result.messageId };
  },
});

const emailSend = define({
  key: "email.send",
  idempotent: false,
  inputSchema: z.object({ to: z.string().email(), subject: z.string().min(1), html: z.string().min(1) }),
  async handler(input) {
    const result = await sendEmail(input);
    if (!result.ok) throw new Error(`email.send: ${result.message}`);
    return { providerId: result.id };
  },
});

const whatsappSendTemplate = define({
  key: "whatsapp.sendTemplate",
  idempotent: false,
  inputSchema: z.object({ to: z.string().min(6), templateKey: z.string().min(1), params: z.array(z.string()).optional() }),
  async handler(input) {
    const result = await sendWhatsAppTemplate(input);
    if (!result.ok) {
      // "Not configured" / "template not set" / "templates not approved" are expected, recoverable
      // states (the equivalent n8n flow just skips the WhatsApp branch and alerts the team) — never
      // a hard step failure that exhausts retries for a config problem a retry cannot fix.
      if (result.reason !== "provider_error") return { sent: false, reason: result.reason, message: result.message };
      throw new Error(`whatsapp.sendTemplate: ${result.message}`);
    }
    return { sent: true, messageId: result.messageId };
  },
});

const emitEventAction = define({
  key: "event.emit",
  idempotent: true,
  inputSchema: z.object({ eventType: z.string().min(1), payload: z.record(z.unknown()), dedupeKey: z.string().optional() }),
  async handler(input) {
    const result = await emitEvent(prisma, input.eventType as EngineEventType, input.payload, input.dedupeKey);
    return { outboxId: result.id, deduped: result.deduped };
  },
});

export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  [leadUpsert.key]: leadUpsert as ActionDefinition,
  [waitlistAdd.key]: waitlistAdd as ActionDefinition,
  [referralRecord.key]: referralRecord as ActionDefinition,
  [feedbackRecord.key]: feedbackRecord as ActionDefinition,
  [notifyTelegram.key]: notifyTelegram as ActionDefinition,
  [emailSend.key]: emailSend as ActionDefinition,
  [whatsappSendTemplate.key]: whatsappSendTemplate as ActionDefinition,
  [emitEventAction.key]: emitEventAction as ActionDefinition,
};

export function getAction(key: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[key];
}
