/**
 * WhatsApp nurture sequences — native TypeScript port of n8n workflow 19
 * ("Eki - 19 WhatsApp Nurture Sequences"). Same business rules as the n8n
 * version (vendor days 1/2/3/7/14, buyer days 1/3/5, approved templates
 * only, 20h cooldown between sends, configurable per-run cap), ported onto
 * this app's own Postgres `WhatsAppContact` instead of the old Google
 * Sheets lead store — n8n's `lead_captured` status maps to this app's own
 * onboarding completion (`status: "COMPLETE"`, set by conversation.ts once
 * a vendor/buyer finishes signup).
 *
 * Unlike n8n's version, a contact's nurture progress (`nurtureDay`,
 * `lastNurtureAt`) is tracked on its own columns rather than overloading
 * the onboarding `status` field — COMPLETE still means "onboarded", not
 * "mid-nurture", so conversation.ts's own state machine is untouched.
 */
import { prisma } from "../lib/prisma";
import { requireConnected } from "../lib/credentials";
import { timedFetch, describeHttpFailure, readErrorDetail, ProviderError } from "../lib/http";
import { WhatsAppContact } from "@prisma/client";

export interface NurtureStep {
  day: number;
  /** Config field name on the `whatsapp` Integration — see api/src/modules/providers/definitions.ts's templateFieldName(). */
  templateField: string;
  linkKind: "vendor" | "app";
}

/** Vendor days 1,2,3,7,14 · Buyer days 1,3,5 — exact same days/order as n8n workflow 19's SEQ. */
export const NURTURE_SEQUENCES: Record<"vendor" | "buyer", NurtureStep[]> = {
  vendor: [
    { day: 1, templateField: "tplNurtureVendorD1", linkKind: "vendor" },
    { day: 2, templateField: "tplNurtureVendorD2", linkKind: "vendor" },
    { day: 3, templateField: "tplNurtureVendorD3", linkKind: "vendor" },
    { day: 7, templateField: "tplNurtureVendorD7", linkKind: "vendor" },
    { day: 14, templateField: "tplNurtureVendorD14", linkKind: "vendor" },
  ],
  buyer: [
    { day: 1, templateField: "tplNurtureBuyerD1", linkKind: "app" },
    { day: 3, templateField: "tplNurtureBuyerD3", linkKind: "app" },
    { day: 5, templateField: "tplNurtureBuyerD5", linkKind: "app" },
  ],
};

/** Cooldown between two nurture sends to the same contact (n8n workflow 19: `hoursSince(last_nurture) >= 20`). */
const MIN_HOURS_BETWEEN_SENDS = 20;
/** Tolerance so a run a few minutes before the exact day boundary still fires (n8n workflow 19: `- 0.05` days). */
const DAY_TOLERANCE = 0.05;

export type NurtureContact = Pick<WhatsAppContact, "phone" | "role" | "status" | "optIn" | "nurtureDay" | "lastNurtureAt" | "optInAt" | "createdAt">;

/**
 * Pure selection logic — no DB, no HTTP — so the day-sequencing/rate-limit
 * rules are directly testable. Returns the next nurture step due for this
 * contact right now, or null if none is due (not eligible, already caught
 * up, cooling down, or too early for the next day).
 */
export function nextNurtureStep(contact: NurtureContact, now: Date = new Date()): NurtureStep | null {
  if (!contact.optIn || contact.status !== "COMPLETE") return null;
  const seq = contact.role === "vendor" ? NURTURE_SEQUENCES.vendor : contact.role === "buyer" ? NURTURE_SEQUENCES.buyer : null;
  if (!seq) return null;
  const digits = contact.phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  const next = seq.find((s) => s.day > contact.nurtureDay);
  if (!next) return null;

  const anchor = contact.optInAt ?? contact.createdAt;
  const daysSinceAnchor = (now.getTime() - anchor.getTime()) / 86_400_000;
  if (daysSinceAnchor < next.day - DAY_TOLERANCE) return null;

  if (contact.lastNurtureAt) {
    const hoursSinceLastSend = (now.getTime() - contact.lastNurtureAt.getTime()) / 3_600_000;
    if (hoursSinceLastSend < MIN_HOURS_BETWEEN_SENDS) return null;
  }
  return next;
}

interface WhatsAppCreds {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  templateLang?: string;
  maxPerRun?: string;
  [templateField: string]: string | undefined;
}

async function sendTemplate(creds: WhatsAppCreds, toPhone: string, templateName: string, bodyParams: string[]): Promise<void> {
  const ver = creds.graphVersion || "v23.0";
  const lang = creds.templateLang || "en";
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").slice(0, 900) || "-";
  const { res } = await timedFetch(
    `https://graph.facebook.com/${ver}/${encodeURIComponent(creds.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone.replace(/\D/g, ""),
        type: "template",
        template: { name: templateName, language: { code: lang }, components: [{ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: clean(p) })) }] },
      }),
    },
    15_000,
  );
  if (!res.ok) throw describeHttpFailure("WhatsApp", res.status, await readErrorDetail(res));
}

export interface NurtureRunSummary {
  eligible: number;
  sent: number;
  failed: number;
  missingTemplates: string[];
  firstError?: string;
}

/**
 * Runs one nurture sweep: every contact due for its next sequence step gets
 * one approved-template WhatsApp message, up to `maxPerRun`. Mirrors n8n
 * workflow 19 end to end (select -> send -> record -> summarize) in one
 * pass instead of five node-to-node handoffs.
 */
export async function runWhatsAppNurture(): Promise<NurtureRunSummary> {
  const creds = await requireConnected("whatsapp", "WhatsApp");
  const settings = await prisma.setting.findMany({ where: { key: { in: ["appDownloadLink", "appVendorLink"] } } });
  const appLink = (settings.find((s) => s.key === "appDownloadLink")?.value as string | undefined) || "our app";
  const vendorLink = (settings.find((s) => s.key === "appVendorLink")?.value as string | undefined) || appLink;

  const maxPerRun = Math.max(1, parseInt(creds.maxPerRun ?? "40", 10) || 40);
  const now = new Date();
  const candidates = await prisma.whatsAppContact.findMany({
    where: { optIn: true, status: "COMPLETE", role: { in: ["vendor", "buyer"] } },
  });

  const summary: NurtureRunSummary = { eligible: 0, sent: 0, failed: 0, missingTemplates: [] };
  const missing = new Set<string>();
  let dispatched = 0;

  for (const contact of candidates) {
    const next = nextNurtureStep(contact, now);
    if (!next) continue;
    summary.eligible += 1;
    if (dispatched >= maxPerRun) continue;

    const templateName = creds[next.templateField];
    if (!templateName) {
      missing.add(next.templateField);
      continue;
    }
    dispatched += 1;
    const link = next.linkKind === "vendor" ? vendorLink : appLink;
    try {
      await sendTemplate(creds as WhatsAppCreds, contact.phone, templateName, [contact.name || "there", link]);
      await prisma.whatsAppContact.update({ where: { phone: contact.phone }, data: { nurtureDay: next.day, lastNurtureAt: now, lastNurtureError: null } });
      await prisma.whatsAppMessage.create({
        data: { contact: { connect: { phone: contact.phone } }, direction: "out", body: `[${templateName}] day ${next.day}`, templateName },
      });
      summary.sent += 1;
    } catch (err) {
      const message = err instanceof ProviderError ? err.message : err instanceof Error ? err.message : "Unknown error";
      await prisma.whatsAppContact.update({ where: { phone: contact.phone }, data: { lastNurtureError: message.slice(0, 500) } });
      summary.failed += 1;
      summary.firstError ??= message;
    }
  }

  summary.missingTemplates = [...missing];
  return summary;
}
