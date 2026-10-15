import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Every admin-editable setting, declared once. The Settings page renders
 * from this list and the API validates against it.
 */
export type SettingType = "boolean" | "text" | "url" | "date" | "number" | "select";

export interface SettingDefinition {
  key: string;
  label: string;
  type: SettingType;
  group: "Business" | "Automation safety" | "Confirmations" | "Video defaults" | "Notifications";
  default: string | number | boolean;
  help?: string;
  options?: { value: string; label: string }[];
}

export const SETTINGS: SettingDefinition[] = [
  // Client requirements intake. Blank values are intentional until the
  // questionnaire is answered; no product facts are invented here.
  { key: "brandLegalName", label: "Legal/business name", type: "text", group: "Business", default: "" },
  { key: "brandWebsite", label: "Public website URL", type: "url", group: "Business", default: "" },
  { key: "brandVoice", label: "Brand voice (three words)", type: "text", group: "Business", default: "" },
  { key: "brandPrimaryColor", label: "Primary brand color", type: "text", group: "Business", default: "" },
  { key: "brandSecondaryColor", label: "Secondary brand color", type: "text", group: "Business", default: "" },
  { key: "brandAccentColor", label: "Accent brand color", type: "text", group: "Business", default: "" },
  { key: "brandFonts", label: "Brand fonts", type: "text", group: "Business", default: "" },
  { key: "operatingCountries", label: "Operating countries", type: "text", group: "Business", default: "" },
  { key: "targetDiasporaCommunities", label: "Target diaspora communities", type: "text", group: "Business", default: "" },
  { key: "marketplaceTruth", label: "Approved marketplace facts", type: "text", group: "Business", default: "", help: "Only client-approved facts may be used in generated content." },
  { key: "vendorAudienceProfile", label: "Ideal vendor profile", type: "text", group: "Business", default: "" },
  { key: "buyerAudienceProfile", label: "Ideal buyer profile", type: "text", group: "Business", default: "" },
  { key: "vendorPainPoints", label: "Vendor pain points", type: "text", group: "Business", default: "" },
  { key: "buyerFears", label: "Buyer fears", type: "text", group: "Business", default: "" },
  { key: "productCategories", label: "Approved product categories", type: "text", group: "Business", default: "" },
  { key: "audienceLanguages", label: "Audience languages", type: "text", group: "Business", default: "" },
  { key: "brandedHashtags", label: "Approved branded hashtags", type: "text", group: "Business", default: "" },
  { key: "contentForbiddenTopics", label: "Forbidden content topics", type: "text", group: "Business", default: "" },
  { key: "inspirationAccounts", label: "Inspiration accounts", type: "text", group: "Business", default: "" },
  { key: "pidginPolicy", label: "Pidgin policy", type: "select", group: "Business", default: "unspecified", options: [{ value: "unspecified", label: "Not specified" }, { value: "regularly", label: "Use regularly" }, { value: "occasionally", label: "Use occasionally" }, { value: "none", label: "English only" }] },
  { key: "contentFormats", label: "Priority content formats", type: "text", group: "Business", default: "" },
  { key: "postsPerDay", label: "Target posts per day", type: "number", group: "Business", default: 0 },
  { key: "contentTimezone", label: "Content scheduling timezone", type: "text", group: "Business", default: "" },
  { key: "aiProvider", label: "AI provider for native workflows", type: "select", group: "Business", default: "groq", options: [{ value: "groq", label: "Groq" }, { value: "openai", label: "OpenAI" }], help: "The connected provider whose key and model native AI steps use." },
  { key: "launchDate", label: "Launch date (day 1 of the 30-day content calendar)", type: "date", group: "Business", default: "" },
  { key: "appDownloadLink", label: "App download / public link", type: "url", group: "Business", default: "https://culinarytales.app" },
  { key: "appVendorLink", label: "Vendor sign-up link", type: "url", group: "Business", default: "https://culinarytales.app/sell" },
  { key: "whatsappCtaLink", label: "WhatsApp click-to-chat link (wa.me/...)", type: "url", group: "Business", default: "" },
  { key: "feedbackFormUrl", label: "Feedback survey URL", type: "url", group: "Business", default: "" },
  { key: "feedbackRewardText", label: "Feedback reward sentence (leave empty unless a reward exists)", type: "text", group: "Business", default: "" },
  { key: "appStoreReviewUrl", label: "App Store review URL", type: "url", group: "Business", default: "" },
  { key: "playStoreReviewUrl", label: "Google Play review URL", type: "url", group: "Business", default: "" },

  { key: "autopilotSocialPosting", label: "Allow automatic social posting (Buffer/X)", type: "boolean", group: "Automation safety", default: false, help: "Off = drafts go to Telegram for manual posting. Turn on only after a week of reviewed output." },
  { key: "twitterPostingEnabled", label: "Allow automatic posting to X", type: "boolean", group: "Automation safety", default: false },
  { key: "autopilotStop", label: "EMERGENCY STOP social autopilot", type: "boolean", group: "Automation safety", default: false },
  { key: "emergencyStop", label: "EMERGENCY STOP API and worker execution", type: "boolean", group: "Automation safety", default: false, help: "Blocks new generation, approval and publishing work at enqueue and again in the worker before provider calls." },

  { key: "whatsappTemplatesApproved", label: "I confirm Meta approved the WhatsApp templates entered in Integrations", type: "boolean", group: "Confirmations", default: false, help: "Meta's approval cannot be checked by API; this confirmation unblocks the WhatsApp sequences." },

  { key: "defaultLanguage", label: "Default video language", type: "text", group: "Video defaults", default: "en" },
  { key: "defaultTone", label: "Default tone", type: "text", group: "Video defaults", default: "Professional" },
  { key: "defaultDurationSec", label: "Default duration (seconds)", type: "number", group: "Video defaults", default: 30 },
  { key: "defaultAspectRatio", label: "Default aspect ratio", type: "select", group: "Video defaults", default: "9:16", options: [{ value: "9:16", label: "9:16 vertical" }, { value: "16:9", label: "16:9 landscape" }] },
  { key: "videoMaxAttempts", label: "Automatic attempts per video job", type: "number", group: "Video defaults", default: 2, help: "Transient failures are retried up to this many times; completed stages are never re-run or re-billed." },

  { key: "notifyAdminOnFailure", label: "Send failures to the Telegram team chat", type: "boolean", group: "Notifications", default: true },
];

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS.find((s) => s.key === key);
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.key in stored ? stored[s.key] : s.default]));
}

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const def = getSettingDefinition(key);
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row ? row.value : def?.default) as T;
}

export function validateSetting(def: SettingDefinition, value: unknown): string | null {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "Must be true or false";
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : "Must be a non-negative number";
    case "date":
      return value === "" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))) ? null : "Must be a date (YYYY-MM-DD)";
    case "url":
      if (value === "") return null;
      try {
        const u = new URL(String(value));
        return u.protocol === "https:" || u.protocol === "http:" ? null : "Must be an http(s) URL";
      } catch {
        return "Must be a valid URL";
      }
    case "select":
      return def.options?.some((o) => o.value === value) ? null : `Must be one of ${def.options?.map((o) => o.value).join(", ")}`;
    default:
      return typeof value === "string" && value.length <= 500 ? null : "Must be text (max 500 characters)";
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue },
    create: { key, value: value as Prisma.InputJsonValue },
  });
}
