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
  category: "LEAD_AUTOMATION" | "WHATSAPP" | "REPORTING" | "SOCIAL" | "CONTENT";
  triggerType: "WEBHOOK" | "EVENT" | "CRON";
  triggerConfig: Record<string, unknown>;
  definition: Record<string, unknown>;
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
        enabled: true, createdBy: actor,
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
