import { prisma } from "../../../lib/prisma";
import { validateDefinition, checkActionReferences } from "../definition";
import { ACTION_REGISTRY } from "../actions";
import { ensureScheduledTrigger } from "../scheduler";
import type { Prisma } from "@prisma/client";

/** Deterministic JSON (keys sorted recursively) — Postgres JSONB does not preserve a value's
 * original key insertion order on round-trip, so a plain JSON.stringify() comparison between
 * a seed's in-memory definition and what comes back from the database spuriously differs and
 * would otherwise publish a pointless "upgrade" version on every single boot. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Native replacements for n8n workflows 03, 04, 07, 08 and 09 (the simplest, most self-
 * contained of the 22 — pure webhook/cron → validate → dedupe/lookup → external send →
 * persist flows with no multi-step AI agent logic). Seeding is idempotent: re-running this
 * never duplicates a workflow or republishes an already-published version.
 *
 * See docs/WORKFLOW_ENGINE.md for exactly which of the 22 n8n workflows this covers and which
 * remain on n8n (the complex AI content/social-agent ones) — never claim those are replaced.
 */

interface Seed {
  key: string;
  name: string;
  description: string;
  category: "LEAD_AUTOMATION" | "WHATSAPP" | "REPORTING" | "SOCIAL" | "CONTENT" | "AI";
  triggerType: "WEBHOOK" | "EVENT" | "CRON";
  triggerConfig: Record<string, unknown>;
  definition: Record<string, unknown>;
  /** Default true (matches every earlier seed's behavior — those degrade honestly when a
   * provider is unconfigured). Pass false for a workflow whose action set has NOT yet been
   * exercised against a real provider anywhere (even "honest skip" behavior needs a human to
   * flip it on deliberately) — see docs/WORKFLOW_ENGINE.md's provider-readiness section. */
  enabled?: boolean;
}

const SEEDS: Seed[] = [
  {
    key: "lead-capture-webhook",
    name: "Lead Capture Webhook",
    description: "Native replacement for n8n 03-lead-capture-webhook.json: validates the submission, upserts the lead, sends a WhatsApp welcome template (skipped honestly if not configured/approved), and alerts the team on Telegram.",
    category: "LEAD_AUTOMATION",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "lead-capture-webhook" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "upsert", type: "action", action: "lead.upsert", input: { phone: "{{trigger.phone}}", name: "{{trigger.name}}", email: "{{trigger.email}}", source: "{{trigger.source}}", market: "{{trigger.market}}" } },
        { key: "welcome", type: "action", action: "whatsapp.sendTemplate", input: { to: "{{trigger.phone}}", templateKey: "WELCOME_D1" }, onFailure: "continue" },
        { key: "alert", type: "action", action: "notify.telegram", input: { chatId: "{{trigger.alertChatId}}", text: "New lead: {{trigger.name}} ({{trigger.phone}})" }, onFailure: "continue", condition: { path: "trigger.alertChatId", op: "exists" } },
      ],
    },
  },
  {
    key: "waitlist-management",
    name: "Waitlist Management",
    description: "Native replacement for n8n 04-waitlist-management.json: dedupes on email, records the signup, and sends a confirmation email (and WhatsApp, if the signup opted in).",
    category: "LEAD_AUTOMATION",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "waitlist-management" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "add", type: "action", action: "waitlist.add", input: { email: "{{trigger.email}}", name: "{{trigger.name}}", phone: "{{trigger.phone}}" } },
        { key: "notDuplicate", type: "condition", condition: { path: "add.duplicate", op: "eq", value: false }, onFalse: "skip_remaining" },
        { key: "confirmEmail", type: "action", action: "email.send", input: { to: "{{trigger.email}}", subject: "You're on the waitlist", html: "<p>Thanks for joining the Eki waitlist — we'll be in touch.</p>" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "referral-campaign",
    name: "Referral Campaign",
    description: "Native replacement for n8n 07-referral-campaign.json: matches a referral code to its owner, records the referral (deduping on code+referee), increments the referrer's count, and emails the referrer when matched.",
    category: "LEAD_AUTOMATION",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "referral-campaign" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "record", type: "action", action: "referral.record", input: { referralCode: "{{trigger.referralCode}}", refereeEmail: "{{trigger.refereeEmail}}", refereeName: "{{trigger.refereeName}}" } },
        { key: "matched", type: "condition", condition: { path: "record.status", op: "eq", value: "MATCHED" }, onFalse: "skip_remaining" },
        { key: "notifyReferrer", type: "action", action: "email.send", input: { to: "{{record.referrerEmail}}", subject: "You've got a referral!", html: "<p>Someone just signed up using your referral code.</p>" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "feedback-collection",
    name: "Feedback Collection",
    description: "Native replacement for n8n 08-feedback-collection.json (the inbound half): validates and records a feedback submission, alerting the team on a low rating.",
    category: "REPORTING",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "feedback-collection" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "record", type: "action", action: "feedback.record", input: { leadPhone: "{{trigger.leadPhone}}", rating: "{{trigger.rating}}", comment: "{{trigger.comment}}" } },
        { key: "lowRating", type: "condition", condition: { path: "record.negative", op: "eq", value: true } },
        { key: "alertTeam", type: "action", action: "notify.telegram", input: { chatId: "{{trigger.alertChatId}}", text: "Low feedback rating from {{trigger.leadPhone}}: {{trigger.comment}}" }, onFailure: "continue", condition: { path: "lowRating.result", op: "eq", value: true } },
      ],
    },
  },
  {
    key: "weekly-analytics-report",
    name: "Weekly Analytics Report",
    description: "Native replacement for n8n 09-weekly-analytics-report.json: runs every Monday 09:00 UTC, aggregates the last 7 days of lead/waitlist/referral/feedback activity, persists the figures, and sends the team a Telegram summary.",
    category: "REPORTING",
    triggerType: "CRON",
    triggerConfig: { cron: "0 9 * * 1", timezone: "UTC" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "aggregate", type: "action", action: "report.weeklyAnalytics", input: { periodDays: 7 } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "{{aggregate.summary}}" }, onFailure: "continue" },
        // periodStart/periodEnd come from the aggregation step's OWN output, not trigger.firedAt —
        // this workflow also runs as a MANUAL test-run (no firedAt in that trigger payload), and
        // the aggregated window is what actually happened, not merely what time the CRON fired.
        { key: "emit", type: "action", action: "event.emit", input: { eventType: "report.weekly_due", payload: { periodStart: "{{aggregate.periodStart}}", periodEnd: "{{aggregate.periodEnd}}", metrics: "{{aggregate.metrics}}" } } },
      ],
    },
  },
  {
    key: "manychat-comment-funnel",
    name: "ManyChat Comment Funnel",
    description: "Native replacement for n8n 17-manychat-comment-funnel.json: records a ManyChat commenter/subscriber as a social lead (deduped on channel+subscriber id) and alerts the team.",
    category: "LEAD_AUTOMATION",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "manychat-comment-funnel" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "upsert", type: "action", action: "socialLead.upsert", input: { channel: "manychat", externalId: "{{trigger.subscriberId}}", name: "{{trigger.name}}", phone: "{{trigger.phone}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "ManyChat comment from {{trigger.name}}: {{trigger.comment}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "content-multiplication-engine",
    name: "Content Multiplication Engine",
    description: "Native replacement for n8n 18-content-multiplication-engine.json: takes a content idea, asks the connected AI provider to repurpose it into several platform-specific drafts, and queues them for review. Skips honestly (no drafts queued) if no AI provider is connected — never fabricates content.",
    category: "CONTENT",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "content-multiplication-engine" },
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "multiply",
          type: "action",
          action: "ai.complete",
          input: {
            system:
              'You repurpose one marketing idea into several short-form social posts for a real product team. Return ONLY JSON: {"posts":[{"platform":"instagram|tiktok|x|linkedin","contentType":"caption","body":"...","hashtags":["#..."]}]}. Produce 3-5 posts across different platforms. Never invent statistics, prices, or claims not in the brief.',
            user: "Idea: {{trigger.idea}}\nBrand: {{trigger.brand}}",
          },
        },
        { key: "generated", type: "condition", condition: { path: "multiply.ok", op: "eq", value: true }, onFalse: "skip_remaining" },
        { key: "queue", type: "action", action: "content.queueMany", input: { source: "content-multiplication-engine", drafts: "{{multiply.json.posts}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Content Multiplication Engine queued {{queue.count}} draft(s) for review." }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "social-proof-engine",
    name: "Social Proof Engine",
    description: "Native replacement for n8n 21-social-proof-engine.json: on a qualifying business event (e.g. a milestone), asks the connected AI provider to draft a social-proof post and queues it for review. Skips honestly if no AI provider is connected.",
    category: "CONTENT",
    triggerType: "WEBHOOK",
    triggerConfig: { path: "social-proof-engine" },
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "generate",
          type: "action",
          action: "ai.complete",
          input: {
            system:
              'You write one honest social-proof post from a real event description for a product marketing team. Return ONLY JSON: {"posts":[{"platform":"instagram|x|linkedin","contentType":"caption","body":"...","hashtags":["#..."]}]}. Never invent a statistic, testimonial, or number that is not in the event description.',
            user: "Event: {{trigger.eventType}}\nDetails: {{trigger.details}}",
          },
        },
        { key: "generated", type: "condition", condition: { path: "generate.ok", op: "eq", value: true }, onFalse: "skip_remaining" },
        { key: "queue", type: "action", action: "content.queueMany", input: { source: "social-proof-engine", drafts: "{{generate.json.posts}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Social Proof Engine queued {{queue.count}} draft(s) for review." }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "performance-analyst-agent",
    name: "Performance Analyst Agent",
    description: "Native replacement for n8n 22-performance-analyst-agent.json: runs every Monday 09:30 UTC, aggregates the same 7-day figures as the Weekly Analytics Report, asks the connected AI provider for a short written analysis, and sends it to the team on Telegram (and by email, if Resend is connected). The AI step is skipped honestly (figures still reported) if no AI provider is connected.",
    category: "REPORTING",
    triggerType: "CRON",
    triggerConfig: { cron: "30 9 * * 1", timezone: "UTC" },
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "aggregate", type: "action", action: "report.weeklyAnalytics", input: { periodDays: 7 } },
        {
          key: "analyze",
          type: "action",
          action: "ai.complete",
          input: {
            system: 'You are a growth analyst. Given this week\'s raw metrics, write a short (3-5 sentence) plain-text analysis: what moved, what did not, and one concrete next action. Return ONLY JSON: {"analysis":"..."}. Never invent a number not given to you.',
            user: "Metrics: {{aggregate.metrics}}",
          },
          onFailure: "continue",
        },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "{{aggregate.summary}}" }, onFailure: "continue" },
        {
          key: "analysisAlert",
          type: "action",
          action: "notify.telegram",
          input: { text: "AI analysis: {{analyze.json.analysis}}" },
          onFailure: "continue",
          condition: { path: "analyze.ok", op: "eq", value: true },
        },
      ],
    },
  },
  {
    key: "whatsapp-welcome-sequence",
    name: "WhatsApp Welcome Sequence",
    description: "Native replacement for n8n 05-whatsapp-welcome-sequence.json: runs daily at 09:00 UTC and sends the D1/D2/D3 welcome templates to opted-in leads as each becomes due, tracking per-lead progress so a lead is never sent the same stage twice. Disabled until WhatsApp is connected with Meta-approved templates AND this has been test-run successfully — see docs/WORKFLOW_ENGINE.md.",
    category: "WHATSAPP",
    triggerType: "CRON",
    triggerConfig: { cron: "0 9 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "run",
          type: "action",
          action: "whatsapp.runSequence",
          input: {
            sequenceKey: "welcome",
            referenceField: "createdAt",
            stages: [{ dayOffset: 1, templateKey: "WELCOME_D1" }, { dayOffset: 2, templateKey: "WELCOME_D2" }, { dayOffset: 3, templateKey: "WELCOME_D3" }],
          },
        },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Welcome sequence: sent {{run.sent}}, skipped {{run.skippedLeads}}{{run.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "whatsapp-engagement-followup",
    name: "WhatsApp Engagement Follow-up",
    description: "Native replacement for n8n 06-whatsapp-engagement-followup.json: runs daily at 10:00 UTC and re-engages leads who have gone quiet since their last contact (7/14/21 days), using the REENGAGE_7/14/21 templates. Disabled until WhatsApp is connected with Meta-approved templates AND this has been test-run successfully.",
    category: "WHATSAPP",
    triggerType: "CRON",
    triggerConfig: { cron: "0 10 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "run",
          type: "action",
          action: "whatsapp.runSequence",
          input: {
            sequenceKey: "engagement",
            referenceField: "lastContactedAt",
            stages: [{ dayOffset: 7, templateKey: "REENGAGE_7" }, { dayOffset: 14, templateKey: "REENGAGE_14" }, { dayOffset: 21, templateKey: "REENGAGE_21" }],
          },
        },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Engagement follow-up: sent {{run.sent}}, skipped {{run.skippedLeads}}{{run.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "whatsapp-nurture-sequences",
    name: "WhatsApp Nurture Sequences",
    description: "Native replacement for n8n 19-whatsapp-nurture-sequences.json: runs daily at 08:00 UTC and nurtures vendor leads (D1/D2/D3/D7/D14) and buyer leads (D1/D3/D5) on separate templates, since each lead's track is set explicitly via lead.upsert's leadType — a lead with no leadType set is never guessed at and is skipped by both runs. Disabled until WhatsApp is connected with Meta-approved templates AND this has been test-run successfully.",
    category: "WHATSAPP",
    triggerType: "CRON",
    triggerConfig: { cron: "0 8 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "vendor",
          type: "action",
          action: "whatsapp.runSequence",
          input: {
            sequenceKey: "nurture",
            referenceField: "createdAt",
            leadTypeFilter: "VENDOR",
            stages: [
              { dayOffset: 1, templateKey: "NURTURE_VENDOR_D1" }, { dayOffset: 2, templateKey: "NURTURE_VENDOR_D2" }, { dayOffset: 3, templateKey: "NURTURE_VENDOR_D3" },
              { dayOffset: 7, templateKey: "NURTURE_VENDOR_D7" }, { dayOffset: 14, templateKey: "NURTURE_VENDOR_D14" },
            ],
          },
        },
        {
          key: "buyer",
          type: "action",
          action: "whatsapp.runSequence",
          input: {
            sequenceKey: "nurture",
            referenceField: "createdAt",
            leadTypeFilter: "BUYER",
            stages: [{ dayOffset: 1, templateKey: "NURTURE_BUYER_D1" }, { dayOffset: 3, templateKey: "NURTURE_BUYER_D3" }, { dayOffset: 5, templateKey: "NURTURE_BUYER_D5" }],
          },
        },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Nurture sequences: vendor sent {{vendor.sent}}, buyer sent {{buyer.sent}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "whatsapp-lead-funnel",
    name: "WhatsApp Lead Funnel",
    description: "Native replacement for n8n 13-whatsapp-lead-funnel.json: classifies an inbound WhatsApp message (STOP/START/greeting/buyer/vendor), upserts the lead, replies with a free-form session message (not a template — permitted within the 24h window an inbound message opens), and alerts the team on a high-intent (buyer/vendor self-identification) message. The GET-verification handshake and POST signature verification happen in routes/whatsappWebhook.ts, mounted at /api/webhooks/whatsapp — BEFORE this EVENT-triggered workflow is ever matched; an invalid signature never reaches this far. Disabled until WhatsApp is connected AND a real test message has been verified end to end — see docs/WORKFLOW_ENGINE.md.",
    category: "WHATSAPP",
    triggerType: "EVENT",
    triggerConfig: { eventType: "whatsapp.message_received" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "process", type: "action", action: "whatsapp.processInboundMessage", input: { phone: "{{trigger.phone}}", messageId: "{{trigger.messageId}}", timestamp: "{{trigger.timestamp}}", type: "{{trigger.type}}", text: "{{trigger.text}}", senderName: "{{trigger.senderName}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "HIGH-INTENT LEAD via WhatsApp\nPhone: {{trigger.phone}}\nType: {{process.leadType}}\nSaid: {{trigger.text}}" }, onFailure: "continue", condition: { path: "process.highIntent", op: "eq", value: true } },
      ],
    },
  },
  {
    key: "social-post-scheduler",
    name: "Social Post Scheduler",
    description: "Native replacement for n8n 10-social-post-scheduler.json: runs every 2 hours (10:00-20:00 UTC) and posts the oldest human-APPROVED content draft to its platform (X or Buffer), oldest first. Never posts a draft the content-drafts review queue has not explicitly approved, and never marks a draft PUBLISHED until the provider's own response confirms it (a real tweet id, or Buffer success:true). Gated by the existing autopilotStop/autopilotSocialPosting/twitterPostingEnabled settings. Disabled until X or Buffer is connected, posting is enabled in Settings, AND a real test post has been verified end to end.",
    category: "SOCIAL",
    triggerType: "CRON",
    triggerConfig: { cron: "0 10,12,14,16,18,20 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "post", type: "action", action: "content.postApprovedDraft", input: {} },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Social Post Scheduler: {{post.posted}} (draft {{post.draftId}}, via {{post.publishedVia}}){{post.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "ai-social-autopilot",
    name: "AI Social Autopilot",
    description: "Native replacement for n8n 12-ai-social-autopilot.json: runs daily at 09:00 UTC, asks the connected AI provider to draft a social post, and queues it for human review — a deliberate, documented safety difference from the n8n original, which could self-approve a post via its own AI \"safety check\" step with no human in the loop. This native version NEVER auto-posts anything a human has not explicitly approved in the Content Drafts queue; it then opportunistically tries to post whatever IS already approved (which may be from an earlier run), via the same content.postApprovedDraft action social-post-scheduler uses — one posting pathway, not two. Disabled until an AI provider and X/Buffer are connected AND posting is enabled in Settings.",
    category: "SOCIAL",
    triggerType: "CRON",
    triggerConfig: { cron: "0 9 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        {
          key: "generate",
          type: "action",
          action: "ai.complete",
          input: {
            system:
              'You write one daily social media post for a product marketing team promoting a real app. Return ONLY JSON: {"posts":[{"platform":"instagram|x|linkedin","contentType":"caption","body":"...","hashtags":["#..."]}]}. Never invent a statistic, price, or claim not given to you.',
            user: "Brand: Eki — a marketplace connecting African foodstuff vendors with buyers worldwide.",
          },
        },
        { key: "generated", type: "condition", condition: { path: "generate.ok", op: "eq", value: true }, onFalse: "skip_remaining" },
        { key: "queue", type: "action", action: "content.queueMany", input: { source: "ai-social-autopilot", drafts: "{{generate.json.posts}}" } },
        { key: "post", type: "action", action: "content.postApprovedDraft", input: {}, onFailure: "continue" },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "AI Social Autopilot queued {{queue.count}} draft(s); post attempt: {{post.posted}}{{post.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "viral-intelligence-engine",
    name: "Viral Intelligence Engine",
    description: "Native replacement for n8n 15-viral-intelligence-engine.json: runs every 6 hours, runs the configured Apify actor to scrape trending posts, asks the connected AI provider to extract hook/emotion/content-format patterns, and persists them to EngineTrendPattern (replacing the n8n workflow's \"Intelligence\" Google Sheets tab). Skips honestly if Apify or an AI provider is not connected — never fabricates patterns. Disabled until Apify AND an AI provider are connected and a real test-run has been verified.",
    category: "AI",
    triggerType: "CRON",
    triggerConfig: { cron: "0 */6 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "run", type: "action", action: "apify.runTrendsActor", input: {} },
        { key: "configured", type: "condition", condition: { path: "run.ok", op: "eq", value: true }, onFalse: "skip_remaining" },
        { key: "analyze", type: "action", action: "intelligence.analyzeTrends", input: { items: "{{run.items}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Viral Intelligence Engine saved {{analyze.savedCount}} pattern(s){{analyze.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "pain-discovery-engine",
    name: "Pain Discovery Engine",
    description: "Native replacement for n8n 16-pain-discovery-engine.json: runs daily at 06:00 UTC, searches r/Nigeria+diaspora+AfricanFood on Reddit's public API for \"foodstuff vendor problem\" posts from the past week, asks the connected AI provider to categorize which ones describe a real pain point, and persists them to EnginePainPoint (replacing the \"Pain DB\" Google Sheets tab). Skips honestly if no AI provider is connected. Reddit's search endpoint needs no credentials, so this workflow's only real dependency is the AI provider — disabled until one is connected and a real test-run has been verified.",
    category: "AI",
    triggerType: "CRON",
    triggerConfig: { cron: "0 6 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "fetch", type: "action", action: "reddit.searchPosts", input: { subreddits: ["Nigeria", "diaspora", "AfricanFood"], query: "foodstuff vendor problem", sort: "top", time: "week", limit: 20 } },
        { key: "analyze", type: "action", action: "intelligence.analyzePainPoints", input: { posts: "{{fetch.posts}}" } },
        { key: "alert", type: "action", action: "notify.telegram", input: { text: "Pain Discovery Engine saved {{analyze.savedCount}} pain point(s){{analyze.reason}}" }, onFailure: "continue" },
      ],
    },
  },
  {
    key: "ai-content-generation",
    name: "AI Content Generation",
    description: "Native replacement for n8n 01-ai-content-generation.json: runs daily at 09:00 UTC, picks today's row from the 30-day EngineContentCalendarEntry plan (admin-curated ahead of time — see /api/engine/content-calendar), asks the connected AI provider to draft the day's hook/caption/hashtags/video script, saves it as an EngineContentDraft, and sends the team a Telegram message with /approve, /reject and /edit <day> <feedback> instructions. Those commands are handled directly in the existing Telegram webhook route (routes/approvals.ts) — the same place video-approval button presses already are — not by a second EngineWorkflow; see docs/WORKFLOW_ENGINE.md for why 02-content-approval has no corresponding workflow row. Disabled until an AI provider is connected, the launchDate setting and at least one calendar entry exist, and a real test-run has been verified.",
    category: "CONTENT",
    triggerType: "CRON",
    triggerConfig: { cron: "0 9 * * *", timezone: "UTC" },
    enabled: false,
    definition: {
      maxAttempts: 3,
      steps: [
        { key: "generate", type: "action", action: "contentCalendar.generateDraft", input: {} },
        {
          key: "alert",
          type: "action",
          action: "notify.telegram",
          input: { text: "{{generate.approvalText}}" },
          onFailure: "continue",
          condition: { path: "generate.posted", op: "eq", value: true },
        },
      ],
    },
  },
];

export async function seedPortedWorkflows(actor = "seed"): Promise<{ created: string[]; alreadyPresent: string[]; upgraded: string[] }> {
  const created: string[] = [];
  const alreadyPresent: string[] = [];
  const upgraded: string[] = [];
  const knownActions = new Set(Object.keys(ACTION_REGISTRY));

  for (const seed of SEEDS) {
    const parsed = validateDefinition(seed.definition);
    if (!parsed.ok) throw new Error(`Seed "${seed.key}" has an invalid definition: ${parsed.errors.join("; ")}`);
    const unknown = checkActionReferences(parsed.definition, knownActions);
    if (unknown.length) throw new Error(`Seed "${seed.key}" references unknown action(s): ${unknown.join(", ")}`);

    const existing = await prisma.engineWorkflow.findUnique({ where: { key: seed.key }, include: { currentVersion: true } });
    if (existing) {
      // This workflow key was seeded before, possibly with an older definition (e.g. the
      // original weekly-analytics-report only emitted an event; it now runs a real report).
      // Published versions are immutable, so an improved seed publishes a NEW version rather
      // than mutating history — exactly the version-history/rollback mechanism admins get too.
      const unchanged = existing.currentVersion && stableStringify(existing.currentVersion.definition) === stableStringify(seed.definition);
      if (unchanged) { alreadyPresent.push(seed.key); continue; }
      const latest = await prisma.engineWorkflowVersion.findFirst({ where: { workflowId: existing.id }, orderBy: { version: "desc" } });
      const nextVersion = (latest?.version ?? 0) + 1;
      const version = await prisma.engineWorkflowVersion.create({
        data: { workflowId: existing.id, version: nextVersion, status: "PUBLISHED", definition: seed.definition as Prisma.InputJsonValue, createdBy: actor, publishedAt: new Date(), publishedBy: actor, notes: "Auto-upgraded by seedPortedWorkflows() to a newer native definition" },
      });
      await prisma.engineWorkflow.update({ where: { id: existing.id }, data: { currentVersionId: version.id, description: seed.description } });
      upgraded.push(seed.key);
      continue;
    }

    const workflow = await prisma.engineWorkflow.create({
      data: {
        key: seed.key, name: seed.name, description: seed.description, category: seed.category,
        triggerType: seed.triggerType, triggerConfig: seed.triggerConfig as Prisma.InputJsonValue,
        enabled: seed.enabled ?? true, createdBy: actor,
      },
    });
    const version = await prisma.engineWorkflowVersion.create({
      data: { workflowId: workflow.id, version: 1, status: "PUBLISHED", definition: seed.definition as Prisma.InputJsonValue, createdBy: actor, publishedAt: new Date(), publishedBy: actor },
    });
    await prisma.engineWorkflow.update({ where: { id: workflow.id }, data: { currentVersionId: version.id } });
    if (seed.triggerType === "CRON") {
      const { cron, timezone } = seed.triggerConfig as { cron: string; timezone: string };
      await ensureScheduledTrigger(workflow.id, cron, timezone);
    }
    created.push(seed.key);
  }
  return { created, alreadyPresent, upgraded };
}
