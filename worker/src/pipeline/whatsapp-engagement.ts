/**
 * WhatsApp engagement follow-up — native TypeScript port of n8n workflow
 * 06 ("Eki - 06 WhatsApp Engagement Follow-up"). n8n gated this on
 * `status === 'nurturing'`, a status workflow 19 itself set once a contact
 * finished its nurture sequence. This app's nurture port (whatsapp-
 * nurture.ts) deliberately never repurposes `status` that way — COMPLETE
 * always means "onboarded", nothing else — so "finished nurture" is
 * computed here instead, from `nurtureDay` reaching the last day of that
 * role's sequence. Same signal, no redundant status flag.
 */
import { prisma } from "../lib/prisma";
import { requireConnected } from "../lib/credentials";
import { WhatsAppCreds, sendWhatsAppTemplate } from "../lib/whatsapp-template";
import { NURTURE_SEQUENCES } from "./whatsapp-nurture";
import { WhatsAppContact } from "@prisma/client";

const STEPS: Record<number, string> = { 0: "tplReengage7", 1: "tplReengage14", 2: "tplReengage21" };
/** n8n: `inactiveDays < 7` is skipped — same 7-day quiet window before the first re-engagement touch. */
const MIN_INACTIVE_DAYS = 7;

export type EngagementContact = Pick<WhatsAppContact, "phone" | "role" | "status" | "optIn" | "nurtureDay" | "reengageStep" | "lastMessageAt" | "lastNurtureAt" | "lastReengageAt">;

export interface EngagementStep {
  stepIndex: number;
  templateField: string;
}

function finishedNurture(contact: Pick<WhatsAppContact, "role" | "nurtureDay">): boolean {
  const seq = contact.role === "vendor" ? NURTURE_SEQUENCES.vendor : contact.role === "buyer" ? NURTURE_SEQUENCES.buyer : null;
  if (!seq) return false;
  const lastDay = seq[seq.length - 1]!.day;
  return contact.nurtureDay >= lastDay;
}

/** Pure — no DB — mirrors n8n's "Select Inactive Leads". */
export function nextEngagementStep(contact: EngagementContact, now: Date = new Date()): EngagementStep | null {
  if (!contact.optIn || contact.status !== "COMPLETE" || !finishedNurture(contact)) return null;
  if (contact.reengageStep > 2) return null;

  const anchor = [contact.lastMessageAt, contact.lastNurtureAt, contact.lastReengageAt].reduce<Date | null>(
    (latest, d) => (d && (!latest || d > latest) ? d : latest),
    null,
  );
  const inactiveDays = anchor ? (now.getTime() - anchor.getTime()) / 86_400_000 : Infinity;
  if (inactiveDays < MIN_INACTIVE_DAYS) return null;

  return { stepIndex: contact.reengageStep, templateField: STEPS[contact.reengageStep]! };
}

export interface EngagementRunSummary {
  eligible: number;
  sent: number;
  failed: number;
  missingTemplates: string[];
  firstError?: string;
}

export async function runWhatsAppEngagement(): Promise<EngagementRunSummary> {
  const creds = await requireConnected("whatsapp", "WhatsApp");
  const appLinkSetting = await prisma.setting.findUnique({ where: { key: "appDownloadLink" } });
  const appLink = (appLinkSetting?.value as string | undefined) || "our app";

  const maxPerRun = Math.max(1, parseInt(creds.maxPerRun ?? "40", 10) || 40);
  const now = new Date();
  const candidates = await prisma.whatsAppContact.findMany({ where: { optIn: true, status: "COMPLETE", role: { in: ["vendor", "buyer"] } } });

  const summary: EngagementRunSummary = { eligible: 0, sent: 0, failed: 0, missingTemplates: [] };
  const missing = new Set<string>();
  let dispatched = 0;

  for (const contact of candidates) {
    const next = nextEngagementStep(contact, now);
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
      await prisma.whatsAppContact.update({ where: { phone: contact.phone }, data: { reengageStep: next.stepIndex + 1, lastReengageAt: now } });
      await prisma.whatsAppMessage.create({ data: { contact: { connect: { phone: contact.phone } }, direction: "out", body: `[${templateName}] re-engage step ${next.stepIndex}`, templateName } });
      summary.sent += 1;
    } catch (err) {
      summary.failed += 1;
      summary.firstError ??= err instanceof Error ? err.message : "Unknown error";
    }
  }

  summary.missingTemplates = [...missing];
  return summary;
}
