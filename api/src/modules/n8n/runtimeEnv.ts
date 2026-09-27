import crypto from "node:crypto";
import { getProviderValues } from "../integrations/vault";
import { SETTINGS, getAllSettings } from "../settings/schema";
import { WA_TEMPLATE_KEYS, templateFieldName } from "../providers/definitions";

/**
 * The 22 workflows read their configuration through `$env.*` (validated in
 * staging that way — see docs/env-vars.md). Instead of anyone editing n8n's
 * environment variables, the Control Center computes them from what the
 * admin entered in Integrations/Settings, and the n8n supervisor
 * (docker/n8n/supervisor.mjs) fetches this over the private network at
 * start-up and restarts n8n when the version hash changes.
 */

const AI_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
};

async function values(provider: string): Promise<Record<string, string> | null> {
  try {
    return await getProviderValues(provider);
  } catch {
    return null; // unreadable credentials → treated as not configured
  }
}

export async function computeN8nRuntimeEnv(): Promise<{ env: Record<string, string>; version: string }> {
  const env: Record<string, string> = {};
  const settings = await getAllSettings();

  // AI: the provider chosen in Settings, falling back to whichever is configured.
  const preferred = String(settings.aiProvider ?? "groq");
  for (const provider of [preferred, ...Object.keys(AI_BASE_URLS).filter((p) => p !== preferred)]) {
    const v = await values(provider);
    if (v?.apiKey) {
      env.AI_API_BASE_URL = AI_BASE_URLS[provider]!;
      env.AI_API_KEY = v.apiKey;
      if (v.model) env.AI_MODEL = v.model;
      break;
    }
  }

  const sheets = await values("google-sheets");
  if (sheets?.spreadsheetId) env.GOOGLE_SHEETS_ID = sheets.spreadsheetId;

  const telegram = await values("telegram");
  if (telegram?.approvalChatId) env.TELEGRAM_CHAT_ID = telegram.approvalChatId;

  const wa = await values("whatsapp");
  if (wa) {
    const map: Record<string, string | undefined> = {
      WHATSAPP_ACCESS_TOKEN: wa.accessToken,
      WHATSAPP_PHONE_NUMBER_ID: wa.phoneNumberId,
      WHATSAPP_VERIFY_TOKEN: wa.verifyToken,
      WHATSAPP_APP_SECRET: wa.appSecret,
      WHATSAPP_GRAPH_VERSION: wa.graphVersion,
      WA_TEMPLATE_LANG: wa.templateLang,
      WA_MAX_PER_RUN: wa.maxPerRun,
    };
    for (const key of WA_TEMPLATE_KEYS) map[`WA_TPL_${key}`] = wa[templateFieldName(key)];
    for (const [k, v] of Object.entries(map)) if (v) env[k] = v;
  }

  const resend = await values("resend");
  if (resend?.apiKey) env.RESEND_API_KEY = resend.apiKey;
  if (resend?.fromEmail) env.RESEND_FROM_EMAIL = resend.fromEmail;
  if (resend?.teamEmail) env.TEAM_EMAIL = resend.teamEmail;

  const buffer = await values("buffer");
  if (buffer?.accessToken) env.BUFFER_API_KEY = buffer.accessToken;
  const profiles: Record<string, string | undefined> = {
    BUFFER_PROFILE_ID_INSTAGRAM: buffer?.profileIdInstagram,
    BUFFER_PROFILE_ID_FACEBOOK: buffer?.profileIdFacebook,
    BUFFER_PROFILE_ID_LINKEDIN: buffer?.profileIdLinkedin,
    BUFFER_PROFILE_ID_TIKTOK: buffer?.profileIdTiktok,
  };
  for (const [k, v] of Object.entries(profiles)) if (v) env[k] = v;

  const apify = await values("apify");
  if (apify?.apiToken) env.APIFY_TOKEN = apify.apiToken;
  if (apify?.trendsActorId) env.APIFY_TRENDS_ACTOR_ID = apify.trendsActorId;
  if (apify?.trendsInputJson) env.APIFY_TRENDS_INPUT_JSON = apify.trendsInputJson;

  for (const def of SETTINGS) {
    if (!def.n8nEnv) continue;
    const v = settings[def.key];
    if (typeof v === "boolean") env[def.n8nEnv] = v ? "true" : "false";
    else if (v !== undefined && v !== null && String(v) !== "") env[def.n8nEnv] = String(v);
  }

  const canonical = JSON.stringify(Object.keys(env).sort().map((k) => [k, env[k]]));
  const version = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return { env, version };
}
