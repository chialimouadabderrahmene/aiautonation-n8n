/**
 * WhatsApp welcome sequence — native TypeScript port of n8n workflow 05
 * ("Eki - 05 WhatsApp Welcome Sequence"). Same rule as n8n: days 1/2/3,
 * approved templates only, 20h cooldown after day 1, configurable
 * per-run cap, targeting opted-in contacts that are still `status: "NEW"`
 * (n8n's `status === 'new'`) — this is a distinct, earlier lifecycle stage
 * than nurture's `status: "COMPLETE"` gate (worker/src/pipeline/whatsapp-
 * nurture.ts), so the two sequences never both message the same contact
 * on the same day. A contact reaches NEW+optIn=true via conversation.ts's
 * JOIN branch (opts in without yet choosing a role).
 */
import { prisma } from "../lib/prisma";
import { requireConnected } from "../lib/credentials";
import { WhatsAppCreds, sendWhatsAppTemplate } from "../lib/whatsapp-template";
import { WhatsAppContact } from "@prisma/client";

const STEPS: Record<number, string> = { 1: "tplWelcomeD1", 2: "tplWelcomeD2", 3: "tplWelcomeD3" };
/** Day 1 fires as soon as eligible; days 2-3 wait 20h since the last welcome send — n8n: `if (day > 1 && hoursSince(last_wa) < 20) continue`. */
const MIN_HOURS_AFTER_DAY1 = 20;

export type WelcomeContact = Pick<WhatsAppContact, "phone" | "status" | "optIn" | "welcomeDay" | "lastWelcomeAt">;

export interface WelcomeStep {
  day: number;
  templateField: string;
}

/** Pure — no DB — mirrors n8n's "Select Welcome Leads" day-advance/cooldown rule. */
export function nextWelcomeStep(contact: WelcomeContact, now: Date = new Date()): WelcomeStep | null {
  if (!contact.optIn || contact.status !== "NEW") return null;
  const digits = contact.phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  const day = contact.welcomeDay + 1;
  if (day > 3) return null;
  if (day > 1 && contact.lastWelcomeAt) {
    const hoursSinceLastSend = (now.getTime() - contact.lastWelcomeAt.getTime()) / 3_600_000;
    if (hoursSinceLastSend < MIN_HOURS_AFTER_DAY1) return null;
  }
  return { day, templateField: STEPS[day]! };
}

export interface WelcomeRunSummary {
  eligible: number;
  sent: number;
  failed: number;
  missingTemplates: string[];
  firstError?: string;
}

export async function runWhatsAppWelcome(): Promise<WelcomeRunSummary> {
  const creds = await requireConnected("whatsapp", "WhatsApp");
  const appLinkSetting = await prisma.setting.findUnique({ where: { key: "appDownloadLink" } });
  const appLink = (appLinkSetting?.value as string | undefined) || "our app";

  const maxPerRun = Math.max(1, parseInt(creds.maxPerRun ?? "40", 10) || 40);
  const now = new Date();
  const candidates = await prisma.whatsAppContact.findMany({ where: { optIn: true, status: "NEW" } });

  const summary: WelcomeRunSummary = { eligible: 0, sent: 0, failed: 0, missingTemplates: [] };
  const missing = new Set<string>();
  let dispatched = 0;

  for (const contact of candidates) {
    const next = nextWelcomeStep(contact, now);
    if (!next) continue;
    summary.eligible += 1;
    if (dispatched >= maxPerRun) continue;

    const templateName = creds[next.templateField];
    if (!templateName) {
      missing.add(next.templateField);
      continue;
    }
    dispatched += 1;
    try {
      await sendWhatsAppTemplate(creds as WhatsAppCreds, contact.phone, templateName, [contact.name || "there", appLink]);
      await prisma.whatsAppContact.update({ where: { phone: contact.phone }, data: { welcomeDay: next.day, lastWelcomeAt: now } });
      await prisma.whatsAppMessage.create({ data: { contact: { connect: { phone: contact.phone } }, direction: "out", body: `[${templateName}] welcome day ${next.day}`, templateName } });
      summary.sent += 1;
    } catch (err) {
      summary.failed += 1;
      summary.firstError ??= err instanceof Error ? err.message : "Unknown error";
    }
  }

  summary.missingTemplates = [...missing];
  return summary;
}
