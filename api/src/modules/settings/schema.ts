import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/**
 * Every admin-editable setting, declared once. The Settings page renders
 * from this list, the API validates against it, and settings with `n8nEnv`
 * are delivered to n8n automatically (see modules/n8n/runtimeEnv.ts) — this
 * is what replaced hand-editing n8n's environment variables.
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
  /** n8n environment variable this setting is delivered as. */
  n8nEnv?: string;
}

export const SETTINGS: SettingDefinition[] = [
  { key: "aiProvider", label: "AI provider (scripts, carousels, critic, n8n)", type: "select", group: "Business", default: "groq", options: [{ value: "groq", label: "Groq" }, { value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic (Claude)" }], help: "The connected provider every generation call tries first — script/carousel writing, the brand critic, and every AI step in n8n. Falls back to the next connected provider if this one isn't." },
  { key: "launchDate", label: "Launch date (day 1 of the 30-day content calendar)", type: "date", group: "Business", default: "", n8nEnv: "LAUNCH_DATE" },
  { key: "appDownloadLink", label: "App download / public link", type: "url", group: "Business", default: "https://culinarytales.app", n8nEnv: "APP_DOWNLOAD_LINK" },
  { key: "appVendorLink", label: "Vendor sign-up link", type: "url", group: "Business", default: "https://culinarytales.app/sell", n8nEnv: "APP_VENDOR_LINK" },
  { key: "whatsappCtaLink", label: "WhatsApp click-to-chat link (wa.me/...)", type: "url", group: "Business", default: "", n8nEnv: "WHATSAPP_CTA_LINK" },
  { key: "whatsappGroupInviteLink", label: "WhatsApp community group invite link (chat.whatsapp.com/...)", type: "url", group: "Business", default: "", help: "Sent in reply to the JOIN keyword. The Cloud API cannot message people inside a WhatsApp group, so signup still happens in this 1:1 conversation — the group's own pinned message should point back here." },
  { key: "feedbackFormUrl", label: "Feedback survey URL", type: "url", group: "Business", default: "", n8nEnv: "FEEDBACK_FORM_URL" },
  { key: "feedbackRewardText", label: "Feedback reward sentence (leave empty unless a reward exists)", type: "text", group: "Business", default: "", n8nEnv: "FEEDBACK_REWARD_TEXT" },
  { key: "appStoreReviewUrl", label: "App Store review URL", type: "url", group: "Business", default: "", n8nEnv: "APP_STORE_REVIEW_URL" },
  { key: "playStoreReviewUrl", label: "Google Play review URL", type: "url", group: "Business", default: "", n8nEnv: "PLAY_STORE_REVIEW_URL" },

  { key: "autopilotSocialPosting", label: "Allow automatic social posting (Buffer/X)", type: "boolean", group: "Automation safety", default: false, n8nEnv: "AUTOPILOT_SOCIAL_POSTING", help: "Off = drafts go to Telegram for manual posting. Turn on only after a week of reviewed output." },
  { key: "twitterPostingEnabled", label: "Allow workflow 10 to post to X", type: "boolean", group: "Automation safety", default: false, n8nEnv: "TWITTER_POSTING_ENABLED" },
  { key: "autopilotStop", label: "EMERGENCY STOP social autopilot", type: "boolean", group: "Automation safety", default: false, n8nEnv: "AUTOPILOT_STOP" },

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
