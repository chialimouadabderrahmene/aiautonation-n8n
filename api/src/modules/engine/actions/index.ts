import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { sendTelegramMessage } from "../../telegram/telegram";
import { sendEmail } from "../../senders/resend";
import { sendWhatsAppTemplate, sendWhatsAppSessionText } from "../../senders/whatsapp";
import { aiComplete } from "../../senders/ai";
import { postTweet, postToBuffer } from "../../senders/social";
import { runTrendsActor } from "../../senders/apify";
import { searchRedditPosts } from "../../senders/reddit";
import { getProviderValues } from "../../integrations/vault";
import { getSetting } from "../../settings/schema";
import { emitEvent } from "../outbox";
import type { EngineEventType } from "../triggers";
import { LeadStatus, LeadType, ReferralStatus, ContentDraftStatus } from "@prisma/client";

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
  inputSchema: z.object({
    phone: z.string().min(6), name: z.string().optional(), email: z.string().email().optional(), source: z.string().optional(), market: z.string().optional(),
    // UNKNOWN (the default) keeps the lead out of the nurture sequence until this is set
    // explicitly — see the LeadType enum's comment in schema.prisma.
    leadType: z.enum(["VENDOR", "BUYER", "UNKNOWN"]).optional(),
  }),
  async handler(input) {
    const existing = await prisma.engineLead.findUnique({ where: { phone: input.phone } });
    const lead = await prisma.engineLead.upsert({
      where: { phone: input.phone },
      update: { name: input.name ?? undefined, email: input.email ?? undefined, market: input.market ?? undefined, leadType: input.leadType as LeadType | undefined },
      create: { phone: input.phone, name: input.name, email: input.email, source: input.source, market: input.market, status: LeadStatus.NEW, leadType: (input.leadType as LeadType) ?? LeadType.UNKNOWN },
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
  // chatId is optional: scheduled/system workflows (no per-recipient trigger data) alert the
  // team's configured chat — the same "approvalChatId" the Integrations page already tests.
  inputSchema: z.object({ chatId: z.string().min(1).optional(), text: z.string().min(1).max(4000) }),
  async handler(input) {
    const chatId = input.chatId ?? (await getProviderValues("telegram"))?.approvalChatId;
    if (!chatId) return { sent: false, reason: "not_configured", message: "Telegram team chat id is not configured." };
    const result = await sendTelegramMessage(chatId, input.text);
    return { sent: true, messageId: result.messageId };
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

const aiCompleteAction = define({
  key: "ai.complete",
  idempotent: false, // a second AI call is a new (possibly different) generation, not a safe no-op
  inputSchema: z.object({ system: z.string().min(1), user: z.string().min(1), jsonMode: z.boolean().optional() }),
  async handler(input) {
    const result = await aiComplete(input);
    if (!result.ok) {
      // "not configured" is an expected, recoverable state — the equivalent n8n flow just has
      // nothing to generate with; never a hard failure that burns retries for a config problem.
      if (result.reason === "not_configured") return { ok: false, reason: result.reason, message: result.message, json: null as unknown };
      throw new Error(`ai.complete: ${result.message}`);
    }
    return { ok: true, raw: result.raw, json: result.json, provider: result.provider, model: result.model };
  },
});

const contentDraftInput = z.object({
  platform: z.string().optional(),
  contentType: z.string().optional(),
  body: z.string().min(1),
  hashtags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const contentQueueMany = define({
  key: "content.queueMany",
  idempotent: true, // re-running on retry just queues the same drafts again under a fresh id — acceptable duplication for a retried AI-generation step, never silently lost
  // `source` is attached here (the workflow that produced them), not expected from the AI's own
  // JSON output — the model is only ever asked to produce {platform, contentType, body, hashtags}.
  inputSchema: z.object({ source: z.string().min(1), drafts: z.array(contentDraftInput).max(50) }),
  async handler(input) {
    if (input.drafts.length === 0) return { count: 0, ids: [] as string[] };
    const rows = await prisma.$transaction(
      input.drafts.map((d) =>
        prisma.engineContentDraft.create({
          data: { source: input.source, platform: d.platform, contentType: d.contentType, body: d.body, hashtags: d.hashtags ?? [], metadata: (d.metadata ?? {}) as object, status: ContentDraftStatus.DRAFT },
        }),
      ),
    );
    return { count: rows.length, ids: rows.map((r) => r.id) };
  },
});

const socialLeadUpsert = define({
  key: "socialLead.upsert",
  idempotent: true,
  inputSchema: z.object({ channel: z.string().min(1), externalId: z.string().min(1), name: z.string().optional(), phone: z.string().optional() }),
  async handler(input) {
    const existing = await prisma.engineSocialLead.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalId } } });
    const row = await prisma.engineSocialLead.upsert({
      where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
      update: { name: input.name ?? undefined, phone: input.phone ?? undefined, lastCommentAt: new Date(), commentCount: { increment: 1 } },
      create: { channel: input.channel, externalId: input.externalId, name: input.name, phone: input.phone },
    });
    return { socialLeadId: row.id, isNew: !existing, commentCount: row.commentCount };
  },
});

const reportWeeklyAnalytics = define({
  key: "report.weeklyAnalytics",
  idempotent: true, // re-running recomputes the same window's figures; it does not double-count anything
  inputSchema: z.object({ periodDays: z.number().int().min(1).max(31).default(7) }),
  async handler(input) {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - (input.periodDays ?? 7) * 24 * 60 * 60 * 1000);
    const [newLeads, waitlistSignups, referralsMatched, feedbackResponses, negativeFeedback] = await Promise.all([
      prisma.engineLead.count({ where: { createdAt: { gte: periodStart, lte: periodEnd } } }),
      prisma.engineWaitlistEntry.count({ where: { createdAt: { gte: periodStart, lte: periodEnd } } }),
      prisma.engineReferral.count({ where: { createdAt: { gte: periodStart, lte: periodEnd }, status: "MATCHED" } }),
      prisma.engineFeedbackRequest.count({ where: { respondedAt: { gte: periodStart, lte: periodEnd } } }),
      prisma.engineFeedbackRequest.count({ where: { respondedAt: { gte: periodStart, lte: periodEnd }, rating: { lte: 2 } } }),
    ]);
    const metrics = { newLeads, waitlistSignups, referralsMatched, feedbackResponses, negativeFeedback };
    const row = await prisma.engineWeeklyReportRun.create({ data: { periodStart, periodEnd, metrics, recipients: [] } });
    const summary = [
      `Automation report (${periodStart.toISOString().slice(0, 10)} - ${periodEnd.toISOString().slice(0, 10)})`,
      `New leads: ${newLeads}`,
      `Waitlist signups: ${waitlistSignups}`,
      `Referrals matched: ${referralsMatched}`,
      `Feedback responses: ${feedbackResponses} (${negativeFeedback} rated <=2)`,
    ].join("\n");
    return { runId: row.id, metrics, summary, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() };
  },
});

interface SequenceStage {
  /** Days since `referenceField` at which this stage becomes eligible. */
  dayOffset: number;
  templateKey: string;
}

/**
 * The native replacement for the n8n WhatsApp sequence workflows' `splitInBatches` loop
 * (05-whatsapp-welcome-sequence, 06-whatsapp-engagement-followup, 19-whatsapp-nurture-
 * sequences). The engine has no "for each item" step type by design (see
 * docs/WORKFLOW_ENGINE.md §2/§7), so this ONE action does the whole batch itself: it is the
 * composite action that loop was always going to need, parameterised by which sequence and
 * which day-offset→template stages apply.
 *
 * Idempotent resume without a dedicated loop construct: each lead's progress through the
 * sequence (`EngineLead.sequenceState[sequenceKey]`) is written immediately after that lead's
 * send succeeds — not batched at the end — so a crash mid-run, or a retry of this whole step,
 * only ever re-queries for leads that have NOT yet reached their next eligible stage. A lead
 * already sent today's stage is simply excluded by the query on the next invocation; it is
 * never re-sent.
 *
 * Consent and credentials: whatsappOptIn=false leads are excluded by the query (never
 * queried, let alone sent to). If WhatsApp is not connected or templates are not confirmed
 * Meta-approved, this is detected ONCE up front and the whole run is skipped honestly — no
 * partial sends, no fabricated progress. A single lead's specific stage template being unset
 * only skips that lead for this run (other leads may be eligible for a different, configured
 * stage) — it does not abort the batch.
 */
const whatsappRunSequence = define({
  key: "whatsapp.runSequence",
  idempotent: true, // re-running only ever sends to leads not yet advanced past their current stage
  inputSchema: z.object({
    sequenceKey: z.enum(["welcome", "engagement", "nurture"]),
    stages: z.array(z.object({ dayOffset: z.number().int().min(0), templateKey: z.string().min(1) })).min(1),
    referenceField: z.enum(["createdAt", "lastContactedAt"]).default("createdAt"),
    leadTypeFilter: z.enum(["VENDOR", "BUYER"]).optional(),
  }),
  async handler(input) {
    const stages = [...input.stages].sort((a, b) => a.dayOffset - b.dayOffset) as SequenceStage[];
    const maxDayOffset = stages[stages.length - 1]!.dayOffset;

    const approved = await getSetting<boolean>("whatsappTemplatesApproved").catch(() => false);
    const integration = await prisma.integration.findUnique({ where: { provider: "whatsapp" } });
    if (!approved || integration?.status !== "CONNECTED") {
      return { sequenceKey: input.sequenceKey, processed: 0, sent: 0, skippedLeads: 0, reason: "not_configured", message: "WhatsApp is not connected or templates are not confirmed Meta-approved — no leads were queried." };
    }
    const v = await getProviderValues("whatsapp");
    const maxPerRun = Math.max(1, Math.min(200, Number(v?.maxPerRun) || 40));

    // The day-offset/stage eligibility check itself happens per-lead below (it needs each
    // lead's own sequenceState, which Prisma cannot filter on cheaply) — this query is only a
    // candidate prefetch: opted-in, not dead, old enough to ever reach the LAST stage, and (for
    // "engagement", which re-engages leads already contacted once) actually contacted before.
    const oldEnoughSince = new Date(Date.now() - maxDayOffset * 24 * 60 * 60 * 1000);
    const candidates = await prisma.engineLead.findMany({
      where: {
        whatsappOptIn: true,
        status: { not: LeadStatus.DEAD },
        ...(input.referenceField === "lastContactedAt"
          ? { lastContactedAt: { not: null, lte: oldEnoughSince } }
          : { createdAt: { lte: oldEnoughSince } }),
        ...(input.leadTypeFilter ? { leadType: input.leadTypeFilter as LeadType } : {}),
      },
      orderBy: input.referenceField === "lastContactedAt" ? { lastContactedAt: "asc" } : { createdAt: "asc" },
      take: maxPerRun * 3, // over-fetch — most candidates will already be past their next stage
    });

    let sent = 0;
    let skippedLeads = 0;
    const perLead: { leadId: string; result: string }[] = [];
    for (const lead of candidates) {
      if (sent >= maxPerRun) break;
      const reference = (input.referenceField === "lastContactedAt" ? lead.lastContactedAt : lead.createdAt) ?? lead.createdAt;
      const daysSince = Math.floor((Date.now() - reference.getTime()) / (24 * 60 * 60 * 1000));
      const state = (lead.sequenceState as Record<string, { stage: number; lastSentAt: string }>) ?? {};
      const currentStage = state[input.sequenceKey]?.stage ?? 0;
      const nextStage = stages.find((s, i) => i + 1 > currentStage && s.dayOffset <= daysSince);
      if (!nextStage) { skippedLeads++; continue; }
      const stageIndex = stages.indexOf(nextStage) + 1;

      const result = await sendWhatsAppTemplate({ to: lead.phone, templateKey: nextStage.templateKey });
      if (!result.ok) {
        if (result.reason === "not_configured" || result.reason === "templates_not_approved") {
          // A global condition changed mid-run (e.g. disconnected while this was running) — stop
          // rather than keep failing identically for every remaining lead.
          return { sequenceKey: input.sequenceKey, processed: perLead.length, sent, skippedLeads, reason: result.reason, message: result.message, perLead };
        }
        perLead.push({ leadId: lead.id, result: `skipped: ${result.reason}` });
        skippedLeads++;
        continue; // template_not_set for THIS stage, or a provider_error for THIS lead — try the next lead
      }
      await prisma.engineLead.update({
        where: { id: lead.id },
        data: { sequenceState: { ...state, [input.sequenceKey]: { stage: stageIndex, lastSentAt: new Date().toISOString() } }, lastContactedAt: new Date() },
      });
      sent++;
      perLead.push({ leadId: lead.id, result: "sent" });
    }
    return { sequenceKey: input.sequenceKey, processed: perLead.length, sent, skippedLeads, perLead };
  },
});

const STOP_WORDS = ["stop", "unsubscribe", "quit", "cancel", "opt out", "optout", "basta", "stop all"];
const START_WORDS = ["start", "subscribe"];
const GREET_WORDS = ["hi", "hello", "ciao", "hey", "start"];
const BUYER_WORDS = ["buyer", "buy", "acquirente", "comprare", "customer", "shopping"];
const VENDOR_WORDS = ["vendor", "sell", "venditore", "vendere", "seller", "business", "shop owner"];

function normalizeMessageText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/**
 * The native replacement for n8n 13-whatsapp-lead-funnel.json's "Conversation Logic" step —
 * word-list-matched exactly from that workflow (STOP/START/greeting/buyer/vendor keyword
 * lists are reproduced verbatim, not reinvented) so the same inbound message classifies the
 * same way. Replies are free-form text (sendWhatsAppSessionText, not a template) because this
 * is always a reply within the 24h session window opened by the lead's own inbound message —
 * Meta's messaging policy permits that; it is only business-INITIATED messages that require an
 * approved template (see whatsapp.runSequence for those).
 *
 * Runs as ONE composite action (like whatsapp.runSequence) rather than a chain of condition
 * steps: the branching here is genuine string/word-list logic the engine's path-based condition
 * nodes (eq/contains/in on a single context value) cannot express directly.
 */
const whatsappProcessInboundMessage = define({
  key: "whatsapp.processInboundMessage",
  // A given messageId is only ever processed once in practice (the webhook route dedupes via
  // the outbox before this action is ever invoked) — but if it DID run twice, re-classifying
  // the same inbound text and (at worst) re-sending the same reply is a safe repeat, not a
  // corrupting one, so this is marked idempotent rather than fail-on-replay.
  idempotent: true,
  inputSchema: z.object({ phone: z.string().min(6), messageId: z.string().min(1), timestamp: z.string(), type: z.string(), text: z.string(), senderName: z.string().optional() }),
  async handler(input) {
    const existing = await prisma.engineLead.findUnique({ where: { phone: input.phone } });
    const wasOptedOut = existing?.status === LeadStatus.UNSUBSCRIBED || existing?.whatsappOptIn === false;
    const norm = normalizeMessageText(input.text);

    let action: "stop" | "none" | "reply" = "reply";
    let step = "unknown";
    let leadType = existing?.leadType ?? LeadType.UNKNOWN;
    let reply = "";
    let whatsappOptIn = existing?.whatsappOptIn ?? true;
    let status = existing?.status ?? LeadStatus.NEW;
    let highIntent = false;

    if (STOP_WORDS.includes(norm)) {
      action = "stop"; step = "unsubscribed";
      reply = "You have been unsubscribed from Eki messages. Reply START anytime to re-subscribe.";
      status = LeadStatus.UNSUBSCRIBED; whatsappOptIn = false;
    } else if (wasOptedOut && !START_WORDS.includes(norm)) {
      action = "none"; step = "ignored_unsubscribed"; // never message an unsubscribed lead unless they send START
    } else {
      if (wasOptedOut) { status = LeadStatus.NEW; whatsappOptIn = true; }
      if (GREET_WORDS.includes(norm)) {
        step = "greeting";
        reply = "Welcome to Eki!\n\nEki is a marketplace connecting African foodstuff vendors with buyers worldwide.\n\nAre you a *Buyer* or a *Vendor*?\n\nReply: BUYER or VENDOR\n\nReply STOP anytime to opt out.";
      } else if (BUYER_WORDS.some((w) => norm.includes(w))) {
        step = "type_identified"; leadType = LeadType.BUYER; highIntent = true;
        reply = "Great! You are interested as a Buyer.\n\nWhat is your full name and country?\n\nReply STOP anytime to opt out.";
      } else if (VENDOR_WORDS.some((w) => norm.includes(w))) {
        step = "type_identified"; leadType = LeadType.VENDOR; highIntent = true;
        reply = "Awesome! You are a Vendor.\n\nWhat is your full name, country, and what do you sell?\n\nReply STOP anytime to opt out.";
      } else {
        step = "info_provided";
        reply = "Thanks for the info! A member of the Eki team will follow up.\n\nReply STOP anytime to opt out.";
      }
      if (step === "type_identified" && (status === LeadStatus.NEW || status === LeadStatus.WELCOMED)) status = LeadStatus.CONTACTED;
    }

    const lead = await prisma.engineLead.upsert({
      where: { phone: input.phone },
      update: { name: existing?.name ?? input.senderName, status, leadType, whatsappOptIn, conversationStep: step, highIntent, lastContactedAt: new Date() },
      create: { phone: input.phone, name: input.senderName, status, leadType, whatsappOptIn, conversationStep: step, highIntent, source: "whatsapp" },
    });

    let replySent: { ok: boolean; reason?: string; message?: string } = { ok: false, reason: "no_reply_needed" };
    if (reply) {
      const result = await sendWhatsAppSessionText({ to: input.phone, text: reply });
      replySent = result.ok ? { ok: true } : { ok: false, reason: result.reason, message: result.message };
    }

    await prisma.engineWhatsAppConversation.upsert({
      where: { messageId: input.messageId },
      update: {},
      create: { phone: input.phone, messageText: input.text, replySent: reply || null, conversationStep: step, messageId: input.messageId },
    });

    return { leadId: lead.id, action, step, leadType, highIntent, replySent };
  },
});

function bufferProfileField(platform: string): "profileIdInstagram" | "profileIdFacebook" | "profileIdLinkedin" | "profileIdTiktok" | null {
  const p = platform.toLowerCase();
  if (p.includes("instagram")) return "profileIdInstagram";
  if (p.includes("facebook")) return "profileIdFacebook";
  if (p.includes("linkedin")) return "profileIdLinkedin";
  if (p.includes("tiktok")) return "profileIdTiktok";
  return null;
}

/**
 * The native replacement for n8n 10-social-post-scheduler.json's "Select Next Post" ->
 * "Route" -> "Post to Twitter X"/"Post via Buffer" -> "Check Post Result" chain, and the
 * posting half of 12-ai-social-autopilot.json. Reuses the EXISTING autopilotStop/
 * autopilotSocialPosting/twitterPostingEnabled settings (already in modules/settings/
 * schema.ts, already surfaced in the Settings UI) as the same kill-switches the n8n
 * originals read from env vars — not reinvented. Never claims a post is "published" until
 * the provider's own response confirms it (a real tweet id, or Buffer's success:true); on
 * any other outcome the draft stays APPROVED (never silently marked PUBLISHED) with the
 * failure reason recorded for a human to see.
 */
const contentPostApprovedDraft = define({
  key: "content.postApprovedDraft",
  idempotent: true, // only ever acts on a draft still in APPROVED status — a re-run after an already-successful publish finds nothing left to post
  inputSchema: z.object({}),
  async handler() {
    if (await getSetting<boolean>("autopilotStop").catch(() => false)) return { posted: false, reason: "autopilot_stopped" };
    if (!(await getSetting<boolean>("autopilotSocialPosting").catch(() => false))) return { posted: false, reason: "autopilot_disabled" };

    const draft = await prisma.engineContentDraft.findFirst({ where: { status: ContentDraftStatus.APPROVED }, orderBy: [{ reviewedAt: "asc" }, { createdAt: "asc" }] });
    if (!draft) return { posted: false, reason: "no_approved_drafts" };

    const platform = (draft.platform ?? "").toLowerCase();
    let result: { ok: true; providerId: string } | { ok: false; reason: string; message: string };
    let publishedVia: string;

    if (platform.includes("twitter") || platform === "x") {
      if (!(await getSetting<boolean>("twitterPostingEnabled").catch(() => false))) return { posted: false, reason: "twitter_posting_disabled", draftId: draft.id };
      publishedVia = "x";
      result = await postTweet(draft.body);
    } else {
      const field = bufferProfileField(platform);
      if (!field) return { posted: false, reason: "unknown_platform", draftId: draft.id, platform: draft.platform };
      const v = await getProviderValues("buffer");
      const profileId = v?.[field];
      publishedVia = "buffer";
      result = profileId ? await postToBuffer(draft.body, profileId) : { ok: false, reason: "not_configured", message: `No Buffer profile configured for ${platform}.` };
    }

    if (!result.ok) {
      await prisma.engineContentDraft.update({ where: { id: draft.id }, data: { reviewNote: `Publish failed (${publishedVia}): ${result.message}` } });
      return { posted: false, reason: result.reason, message: result.message, draftId: draft.id };
    }
    await prisma.engineContentDraft.update({
      where: { id: draft.id },
      data: { status: ContentDraftStatus.PUBLISHED, metadata: { ...(draft.metadata as object), publishedVia, providerId: result.providerId, publishedAt: new Date().toISOString() } },
    });
    return { posted: true, draftId: draft.id, publishedVia, providerId: result.providerId };
  },
});

/** The native replacement for n8n 15's "Run Apify Actor" node. */
const apifyRunTrendsActor = define({
  key: "apify.runTrendsActor",
  idempotent: false, // re-running genuinely re-scrapes and may return different items — not a safe no-op
  inputSchema: z.object({}),
  async handler() {
    const result = await runTrendsActor();
    if (!result.ok) {
      if (result.reason === "not_configured") return { ok: false, reason: result.reason, message: result.message, items: [] as unknown[] };
      throw new Error(`apify.runTrendsActor: ${result.message}`);
    }
    return { ok: true, items: result.items };
  },
});

/** The native replacement for n8n 16's "Fetch Reddit" node — fixed to reddit.com, see
 * senders/reddit.ts's doc comment for why this is not the forbidden generic-HTTP-action shape. */
const redditSearchPosts = define({
  key: "reddit.searchPosts",
  idempotent: false, // a later identical search can legitimately return new posts
  inputSchema: z.object({ subreddits: z.array(z.string()).min(1), query: z.string().min(1), sort: z.string().optional(), time: z.string().optional(), limit: z.number().int().optional() }),
  async handler(input) {
    const result = await searchRedditPosts(input);
    if (!result.ok) throw new Error(`reddit.searchPosts: ${result.message}`);
    return { ok: true, posts: result.posts };
  },
});

/**
 * Collapses n8n 15's "Build AI Request" -> "AI Analyze Trends" -> "Parse Patterns" into one
 * action: the per-item prompt formatting and the hook/emotion/format row persistence are real
 * array logic the engine's path-based templating cannot express directly (same rationale as
 * whatsapp.processInboundMessage). The prompt text is reproduced from the n8n original
 * verbatim, not reworded.
 */
const intelligenceAnalyzeTrends = define({
  key: "intelligence.analyzeTrends",
  idempotent: false, // a second AI pass is a new (possibly different) analysis, not a safe no-op
  inputSchema: z.object({ items: z.array(z.record(z.unknown())).default([]) }),
  async handler(input) {
    const posts = (input.items ?? []).filter((p) => p.text || p.caption || p.description);
    if (posts.length === 0) return { ok: true, savedCount: 0, reason: "no_posts" };
    const compact = posts.slice(0, 30).map((p, i) => {
      const text = String(p.text ?? p.caption ?? p.description ?? "").slice(0, 280);
      const likes = Number(p.likesCount ?? p.likes ?? 0);
      const comments = Number(p.commentsCount ?? p.comments ?? 0);
      return `${i + 1}. ${text} | likes=${likes} comments=${comments}`;
    });
    const result = await aiComplete({
      system: "You analyse trending social posts for Eki, a marketplace connecting African foodstuff vendors with buyers worldwide. Return ONLY JSON.",
      user: `Analyze these trending posts. Extract: 1) hook patterns 2) emotional triggers 3) content formats. Return JSON with fields: hooks[], emotions[], formats[], creators[] (arrays of short strings).\n\n${compact.join("\n")}`,
    });
    if (!result.ok) {
      if (result.reason === "not_configured") return { ok: false, reason: result.reason, message: result.message, savedCount: 0 };
      throw new Error(`intelligence.analyzeTrends: ${result.message}`);
    }
    const parsed = result.json as { hooks?: unknown[]; emotions?: unknown[]; formats?: unknown[] };
    const rows: { type: string; content: string }[] = [];
    const add = (type: string, arr: unknown[] | undefined) =>
      (Array.isArray(arr) ? arr : []).slice(0, 20).forEach((c) => {
        const s = (typeof c === "string" ? c : JSON.stringify(c)).trim();
        if (s) rows.push({ type, content: s });
      });
    add("hook", parsed.hooks);
    add("emotion", parsed.emotions);
    add("format", parsed.formats);
    if (rows.length === 0) return { ok: true, savedCount: 0, reason: "ai_returned_nothing_usable" };
    await prisma.engineTrendPattern.createMany({ data: rows.map((r) => ({ ...r, source: "apify" })) });
    return { ok: true, savedCount: rows.length };
  },
});

/**
 * Collapses n8n 16's "Build AI Request" -> "AI Categorize" -> "Build Pain Rows" into one
 * action, for the same reason as intelligence.analyzeTrends — the index-based mapping back
 * from the AI's categorization to the original Reddit post is real array logic.
 */
const intelligenceAnalyzePainPoints = define({
  key: "intelligence.analyzePainPoints",
  idempotent: false,
  inputSchema: z.object({ posts: z.array(z.object({ title: z.string(), selftext: z.string().optional(), ups: z.number().optional() })).default([]) }),
  async handler(input) {
    const posts = (input.posts ?? []).slice(0, 20);
    if (posts.length === 0) return { ok: true, savedCount: 0, reason: "no_posts" };
    const listing = posts.map((p, i) => `${i + 1}. ${p.title.slice(0, 200)} :: ${(p.selftext ?? "").slice(0, 300)}`);
    const result = await aiComplete({
      system: "You categorize community posts for Eki, a marketplace connecting African foodstuff vendors with buyers worldwide. Return ONLY JSON.",
      user: `For each numbered post decide if it describes a pain point. Return JSON {"items":[{"index":1,"persona":"vendor|buyer","category":"DM_Chaos|Payment_Fraud|Scam_Fear|No_Buyers|Trust|Other","intensity":1-10,"keywords":["..."]}]}. Skip posts that are not pain points.\n\n${listing.join("\n")}`,
    });
    if (!result.ok) {
      if (result.reason === "not_configured") return { ok: false, reason: result.reason, message: result.message, savedCount: 0 };
      throw new Error(`intelligence.analyzePainPoints: ${result.message}`);
    }
    const parsed = result.json as { items?: { index?: number; persona?: string; category?: string; intensity?: number; keywords?: string[] }[] };
    const rows = (Array.isArray(parsed.items) ? parsed.items : [])
      .map((it) => {
        const post = posts[(Number(it.index) || 0) - 1];
        if (!post) return null;
        return {
          pain: post.title,
          category: String(it.category ?? "Other"),
          intensity: Math.max(0, Math.min(10, Math.trunc(Number(it.intensity) || 0))),
          persona: it.persona ?? null,
          keywords: Array.isArray(it.keywords) ? it.keywords.map(String) : [],
          upvotes: post.ups ?? 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length === 0) return { ok: true, savedCount: 0, reason: "no_pain_points_found" };
    await prisma.enginePainPoint.createMany({ data: rows.map((r) => ({ ...r, source: "reddit" })) });
    return { ok: true, savedCount: rows.length };
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
  [aiCompleteAction.key]: aiCompleteAction as ActionDefinition,
  [contentQueueMany.key]: contentQueueMany as ActionDefinition,
  [socialLeadUpsert.key]: socialLeadUpsert as ActionDefinition,
  [reportWeeklyAnalytics.key]: reportWeeklyAnalytics as ActionDefinition,
  [whatsappRunSequence.key]: whatsappRunSequence as ActionDefinition,
  [whatsappProcessInboundMessage.key]: whatsappProcessInboundMessage as ActionDefinition,
  [contentPostApprovedDraft.key]: contentPostApprovedDraft as ActionDefinition,
  [apifyRunTrendsActor.key]: apifyRunTrendsActor as ActionDefinition,
  [redditSearchPosts.key]: redditSearchPosts as ActionDefinition,
  [intelligenceAnalyzeTrends.key]: intelligenceAnalyzeTrends as ActionDefinition,
  [intelligenceAnalyzePainPoints.key]: intelligenceAnalyzePainPoints as ActionDefinition,
};

export function getAction(key: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[key];
}
