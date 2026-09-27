import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { getProviderValues, getDecryptedCredentials, generateSecretValue } from "../integrations/vault";
import { encrypt, maskSecret } from "../../lib/crypto";
import { timedFetch, scrubSecrets, providerOverrides } from "../../lib/http";
import { publicWebUrl } from "../oauth/oauth";
import { getSetting } from "../settings/schema";
import { logger } from "../../lib/logger";

/**
 * One Telegram bot can have exactly one webhook. The Control Center owns it:
 * it handles the video APPROVE/REJECT buttons itself and forwards every other
 * update (the /approve, /reject, /edit text commands of n8n workflow 02) to
 * n8n's content-approval webhook over the private network, with the same
 * secret header workflow 02 already verifies.
 */

export const WEBHOOK_PATH = "/api/telegram/webhook";
const SETTING_KEY = "_telegramWebhookUrl";

export async function getTelegramWebhookSecret(): Promise<string> {
  const creds = await getDecryptedCredentials("webhooks");
  const existing = creds?.secrets.telegramWebhookSecret;
  if (existing) return existing;
  // Generate once; stored encrypted alongside the inbound webhook secret.
  const value = generateSecretValue();
  const integration = await prisma.integration.findUniqueOrThrow({ where: { provider: "webhooks" } });
  const enc = encrypt(value);
  await prisma.encryptedCredential.upsert({
    where: { integrationId_fieldName: { integrationId: integration.id, fieldName: "telegramWebhookSecret" } },
    update: { ...enc, maskedPreview: maskSecret(value) },
    create: { integrationId: integration.id, fieldName: "telegramWebhookSecret", ...enc, maskedPreview: maskSecret(value) },
  });
  return value;
}

export function secretsEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function botCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const v = await getProviderValues("telegram");
  if (!v?.botToken) throw new Error("Telegram is not configured");
  const { res } = await timedFetch(`https://api.telegram.org/bot${v.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new Error(`Telegram ${method} failed: ${scrubSecrets(data?.description ?? String(res.status), [v.botToken])}`);
  return data.result as T;
}

/** Registers (or confirms) the bot webhook. Idempotent. */
export async function ensureTelegramWebhook(): Promise<{ ok: boolean; message: string }> {
  const integration = await prisma.integration.findUnique({ where: { provider: "telegram" } });
  if (integration?.status !== "CONNECTED") return { ok: false, message: "Telegram is not connected" };
  const base = publicWebUrl();
  if (!base) return { ok: false, message: "PUBLIC_WEB_URL is not set on the API service" };
  if (!base.startsWith("https://") && !providerOverrides()) return { ok: false, message: "Telegram requires an https PUBLIC_WEB_URL" };
  const url = `${base}${WEBHOOK_PATH}`;
  try {
    const info = await botCall<{ url?: string; last_error_message?: string }>("getWebhookInfo", {});
    if (info.url !== url) {
      await botCall("setWebhook", {
        url,
        secret_token: await getTelegramWebhookSecret(),
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: false,
      });
      logger.info({ url }, "[telegram] webhook registered");
    }
    await prisma.setting.upsert({ where: { key: SETTING_KEY }, update: { value: url }, create: { key: SETTING_KEY, value: url } });
    return { ok: true, message: `Webhook registered at ${url}` };
  } catch (err) {
    await prisma.setting.deleteMany({ where: { key: SETTING_KEY } });
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearTelegramWebhookState(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETTING_KEY } });
}

export async function answerCallback(callbackQueryId: string, text: string): Promise<void> {
  await botCall("answerCallbackQuery", { callback_query_id: callbackQueryId, text }).catch(() => undefined);
}

export async function editDecisionMarkup(chatId: string | number, messageId: number, text: string): Promise<void> {
  await botCall("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [[{ text, callback_data: "noop" }]] },
  }).catch(() => undefined);
}

/** Sends a failure/alert line to the team chat when enabled in Settings. Never throws. */
export async function notifyAdmin(text: string): Promise<void> {
  try {
    if ((await getSetting<boolean>("notifyAdminOnFailure")) === false) return;
    const integration = await prisma.integration.findUnique({ where: { provider: "telegram" } });
    if (integration?.status !== "CONNECTED") return;
    const v = await getProviderValues("telegram");
    if (!v?.approvalChatId) return;
    await botCall("sendMessage", { chat_id: v.approvalChatId, text: `⚠️ Eki Control Center\n${scrubSecrets(text, [])}`.slice(0, 4000), disable_web_page_preview: true });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[telegram] admin notification failed");
  }
}
