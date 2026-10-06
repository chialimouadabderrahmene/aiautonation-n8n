/**
 * Daily autopilot status + health digest — native port of n8n workflow 14
 * ("Autopilot Controller"). Same emergency-stop alert and config-health
 * check as n8n's version; the daily counts are remapped onto this app's
 * own vocabulary rather than n8n's (no "flagged" post status exists here —
 * Publication/CarouselPublication use PENDING/PUBLISHING/PUBLISHED/FAILED/
 * SKIPPED, so "posts today" is published-or-failed-today, not generated/
 * approved/flagged).
 */
import { prisma } from "../lib/prisma";
import { getDecryptedCredentials } from "../lib/credentials";

const WA_TEMPLATE_KEYS = [
  "WELCOME_D1", "WELCOME_D2", "WELCOME_D3",
  "REENGAGE_7", "REENGAGE_14", "REENGAGE_21",
  "NURTURE_VENDOR_D1", "NURTURE_VENDOR_D2", "NURTURE_VENDOR_D3", "NURTURE_VENDOR_D7", "NURTURE_VENDOR_D14",
  "NURTURE_BUYER_D1", "NURTURE_BUYER_D3", "NURTURE_BUYER_D5",
  "WAITLIST_CONFIRM",
] as const;

/** Same camelCase rule as api/src/modules/providers/definitions.ts's templateFieldName() — duplicated here rather than imported cross-package, same reasoning as every other api/worker boundary in this codebase. */
function templateFieldName(key: string): string {
  return "tpl" + key.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

export interface ConfigHealth {
  autopilotSocialPosting: boolean;
  aiConfigured: boolean;
  whatsappConfigured: boolean;
  whatsappTemplatesMissing: string[];
  resendConfigured: boolean;
}

export interface DailyCounts {
  date: string;
  leadsToday: number;
  totalLeads: number;
  optedIn: number;
  unsubscribed: number;
  postsPublishedToday: number;
  postsFailedToday: number;
  conversationsToday: number;
}

export interface AutopilotHealthSummary {
  emergencyStop: boolean;
  config: ConfigHealth;
  counts: DailyCounts;
}

/** Pure — mirrors n8n's "Build Daily Summary" text format. */
export function formatAutopilotDigest(s: AutopilotHealthSummary): string {
  const lines = [`Eki Autopilot Daily Report - ${s.counts.date}`, ""];
  if (s.emergencyStop) lines.push("EMERGENCY STOP IS ON — autopilot will not auto-post anything.", "");
  lines.push(
    `Leads: +${s.counts.leadsToday} today, ${s.counts.totalLeads} total, ${s.counts.optedIn} opted-in, ${s.counts.unsubscribed} unsubscribed`,
    `Posts: ${s.counts.postsPublishedToday} published today, ${s.counts.postsFailedToday} failed`,
    `WhatsApp conversations today: ${s.counts.conversationsToday}`,
    "",
    `Autopilot social posting: ${s.config.autopilotSocialPosting ? "ON" : "OFF"}`,
    `AI provider configured: ${s.config.aiConfigured ? "yes" : "no"}`,
    `WhatsApp configured: ${s.config.whatsappConfigured ? "yes" : "no"}`,
  );
  if (s.config.whatsappTemplatesMissing.length) lines.push(`Missing WhatsApp templates: ${s.config.whatsappTemplatesMissing.join(", ")}`);
  lines.push(`Resend (email) configured: ${s.config.resendConfigured ? "yes" : "no"}`);
  return lines.join("\n");
}

export async function runAutopilotController(): Promise<AutopilotHealthSummary> {
  const [autopilotStopSetting, autopilotSocialSetting, whatsapp, resend, aiCandidates] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "autopilotStop" } }),
    prisma.setting.findUnique({ where: { key: "autopilotSocialPosting" } }),
    getDecryptedCredentials("whatsapp"),
    getDecryptedCredentials("resend"),
    Promise.all(["openai", "groq", "anthropic"].map((p) => getDecryptedCredentials(p))),
  ]);

  const whatsappConnected = whatsapp?.status === "CONNECTED" && Boolean(whatsapp.secrets.accessToken) && Boolean(whatsapp.config.phoneNumberId);
  const templatesMissing = whatsappConnected ? WA_TEMPLATE_KEYS.filter((k) => !whatsapp!.config[templateFieldName(k)]) : [...WA_TEMPLATE_KEYS];
  const config: ConfigHealth = {
    autopilotSocialPosting: autopilotSocialSetting?.value === true,
    aiConfigured: aiCandidates.some((c) => c?.status === "CONNECTED"),
    whatsappConfigured: whatsappConnected,
    whatsappTemplatesMissing: templatesMissing,
    resendConfigured: resend?.status === "CONNECTED" && Boolean(resend.secrets.apiKey),
  };

  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [totalLeads, leadsToday, optedIn, unsubscribed, videoPubsToday, carouselPubsToday, conversationsToday] = await Promise.all([
    prisma.whatsAppContact.count(),
    prisma.whatsAppContact.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.whatsAppContact.count({ where: { optIn: true, status: { not: "UNSUBSCRIBED" } } }),
    prisma.whatsAppContact.count({ where: { status: "UNSUBSCRIBED" } }),
    prisma.publication.findMany({ where: { OR: [{ publishedAt: { gte: dayStart } }, { createdAt: { gte: dayStart }, status: "FAILED" }] }, select: { status: true } }),
    prisma.carouselPublication.findMany({ where: { OR: [{ publishedAt: { gte: dayStart } }, { createdAt: { gte: dayStart }, status: "FAILED" }] }, select: { status: true } }),
    prisma.whatsAppMessage.count({ where: { direction: "in", createdAt: { gte: dayStart } } }),
  ]);
  const allPubsToday = [...videoPubsToday, ...carouselPubsToday];
  const counts: DailyCounts = {
    date: now.toISOString().slice(0, 10),
    leadsToday,
    totalLeads,
    optedIn,
    unsubscribed,
    postsPublishedToday: allPubsToday.filter((p) => p.status === "PUBLISHED").length,
    postsFailedToday: allPubsToday.filter((p) => p.status === "FAILED").length,
    conversationsToday,
  };

  return { emergencyStop: autopilotStopSetting?.value === true, config, counts };
}
