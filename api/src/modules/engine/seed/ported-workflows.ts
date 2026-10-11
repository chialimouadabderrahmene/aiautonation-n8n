import { prisma } from "../../../lib/prisma";
import { validateDefinition, checkActionReferences } from "../definition";
import { ACTION_REGISTRY } from "../actions";
import { ensureScheduledTrigger } from "../scheduler";
import type { Prisma } from "@prisma/client";

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
  category: "LEAD_AUTOMATION" | "WHATSAPP" | "REPORTING";
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
    description: "Native replacement for n8n 09-weekly-analytics-report.json: runs every Monday 09:00 UTC and emits a report.weekly_due event for the reporting pipeline to pick up.",
    category: "REPORTING",
    triggerType: "CRON",
    triggerConfig: { cron: "0 9 * * 1", timezone: "UTC" },
    definition: {
      maxAttempts: 3,
      steps: [{ key: "emit", type: "action", action: "event.emit", input: { eventType: "report.weekly_due", payload: { periodStart: "{{trigger.firedAt}}", periodEnd: "{{trigger.firedAt}}" } } }],
    },
  },
];

export async function seedPortedWorkflows(actor = "seed"): Promise<{ created: string[]; alreadyPresent: string[] }> {
  const created: string[] = [];
  const alreadyPresent: string[] = [];
  const knownActions = new Set(Object.keys(ACTION_REGISTRY));

  for (const seed of SEEDS) {
    const existing = await prisma.engineWorkflow.findUnique({ where: { key: seed.key } });
    if (existing) { alreadyPresent.push(seed.key); continue; }

    const parsed = validateDefinition(seed.definition);
    if (!parsed.ok) throw new Error(`Seed "${seed.key}" has an invalid definition: ${parsed.errors.join("; ")}`);
    const unknown = checkActionReferences(parsed.definition, knownActions);
    if (unknown.length) throw new Error(`Seed "${seed.key}" references unknown action(s): ${unknown.join(", ")}`);

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
  return { created, alreadyPresent };
}
