import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { requireConnected, getDecryptedCredentials } from "../lib/credentials";
import { getStorage } from "../lib/storage";
import { timedFetch, ProviderError, scrubSecrets } from "../lib/http";

/**
 * Sends a READY video to the team's Telegram chat with APPROVE / REJECT
 * buttons. The file itself is uploaded (multipart) so the bucket can stay
 * private; files above Telegram's 50 MB bot limit are sent as a 24-hour
 * signed link instead. Button presses come back to the API's Telegram webhook.
 */

const TELEGRAM_MAX_UPLOAD = 49 * 1024 * 1024;

async function telegram<T>(token: string, method: string, body: FormData | Record<string, unknown>): Promise<T> {
  const isForm = body instanceof FormData;
  const { res } = await timedFetch(
    `https://api.telegram.org/bot${token}/${method}`,
    { method: "POST", body: isForm ? body : JSON.stringify(body), headers: isForm ? undefined : { "Content-Type": "application/json" } },
    180_000,
  );
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } | null;
  if (!data?.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(`Telegram ${method} failed: ${scrubSecrets(data?.description ?? String(res.status), [token])}`, res.status, retryable);
  }
  return data.result as T;
}

export async function sendVideoForApproval(videoJobId: string): Promise<void> {
  const tg = await requireConnected("telegram", "Telegram");
  if (!tg.approvalChatId) throw new ProviderError("Telegram team chat ID is not set", null, false);
  const job = await prisma.videoJob.findUniqueOrThrow({ where: { id: videoJobId }, include: { project: true, assets: true } });
  if (job.state !== "READY") throw new ProviderError(`Video is ${job.state}, not READY`, null, false);
  const final = job.assets.find((a) => a.type === "FINAL");
  if (!final) throw new ProviderError("No final video asset", null, false);

  const replyMarkup = { inline_keyboard: [[{ text: "✅ APPROVE", callback_data: `vid:approve:${job.id}` }, { text: "❌ REJECT", callback_data: `vid:reject:${job.id}` }]] };
  const tags = job.hashtags.slice(0, 8).join(" ");
  const caption = `🎬 ${job.project.name}\nPlatform: ${job.project.contentType}${job.project.publishTargets.length ? `\nPublishes to: ${job.project.publishTargets.join(", ")} on approval` : ""}\n\n${job.caption ?? ""}\n${tags}`.slice(0, 1024);

  let messageId: number;
  if ((final.sizeBytes ?? 0) <= TELEGRAM_MAX_UPLOAD) {
    const tmp = path.join(os.tmpdir(), `eki-tg-${job.id}.mp4`);
    try {
      await getStorage().downloadToFile(final.url, tmp);
      const form = new FormData();
      form.set("chat_id", tg.approvalChatId);
      form.set("caption", caption);
      form.set("supports_streaming", "true");
      if (final.width) form.set("width", String(final.width));
      if (final.height) form.set("height", String(final.height));
      if (final.durationSec) form.set("duration", String(Math.round(final.durationSec)));
      form.set("reply_markup", JSON.stringify(replyMarkup));
      form.set("video", await fs.openAsBlob(tmp, { type: "video/mp4" }), `${job.project.name.replace(/[^\w.-]+/g, "_")}.mp4`);
      messageId = (await telegram<{ message_id: number }>(tg.botToken ?? "", "sendVideo", form)).message_id;
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  } else {
    const link = await getStorage().signedUrl(final.url, 24 * 3600);
    messageId = (
      await telegram<{ message_id: number }>(tg.botToken ?? "", "sendMessage", {
        chat_id: tg.approvalChatId,
        text: `${caption}\n\nThe video is larger than Telegram's 50 MB bot limit — watch it here (link valid 24 h):\n${link}`,
        reply_markup: replyMarkup,
      })
    ).message_id;
  }

  await prisma.approval.upsert({
    where: { videoJobId: job.id },
    update: { status: "PENDING", channel: "TELEGRAM", telegramChatId: tg.approvalChatId, telegramMessageId: String(messageId), note: "Sent to Telegram", decidedAt: null, decidedBy: null },
    create: { videoJobId: job.id, channel: "TELEGRAM", telegramChatId: tg.approvalChatId, telegramMessageId: String(messageId), note: "Sent to Telegram" },
  });
}

/**
 * Sends a READY carousel's slides as a Telegram media group (photos),
 * followed by a separate message carrying the APPROVE / REJECT buttons —
 * sendMediaGroup does not support reply_markup, unlike sendVideo above.
 */
export async function sendCarouselForApproval(carouselJobId: string): Promise<void> {
  const tg = await requireConnected("telegram", "Telegram");
  if (!tg.approvalChatId) throw new ProviderError("Telegram team chat ID is not set", null, false);
  const job = await prisma.carouselJob.findUniqueOrThrow({ where: { id: carouselJobId }, include: { project: true, slides: { orderBy: { index: "asc" } } } });
  if (job.state !== "READY") throw new ProviderError(`Carousel is ${job.state}, not READY`, null, false);
  if (job.slides.some((s) => !s.imageUrl)) throw new ProviderError("Not every slide has a rendered image", null, false);

  const tmpFiles: string[] = [];
  try {
    const form = new FormData();
    form.set("chat_id", tg.approvalChatId);
    const media = await Promise.all(
      job.slides.map(async (slide, i) => {
        const tmp = path.join(os.tmpdir(), `eki-tg-carousel-${job.id}-${i}.png`);
        tmpFiles.push(tmp);
        await getStorage().downloadToFile(slide.imageUrl!, tmp);
        const field = `slide${i}`;
        form.set(field, await fs.openAsBlob(tmp, { type: "image/png" }), `slide-${i}.png`);
        return { type: "photo", media: `attach://${field}`, ...(i === 0 ? { caption: `🖼️ ${job.project.name}\nPlatform: ${job.project.platform} carousel\n\n${job.caption ?? ""}`.slice(0, 1024) } : {}) };
      }),
    );
    form.set("media", JSON.stringify(media));
    await telegram(tg.botToken ?? "", "sendMediaGroup", form);

    const replyMarkup = { inline_keyboard: [[{ text: "✅ APPROVE", callback_data: `car:approve:${job.id}` }, { text: "❌ REJECT", callback_data: `car:reject:${job.id}` }]] };
    const messageId = (
      await telegram<{ message_id: number }>(tg.botToken ?? "", "sendMessage", { chat_id: tg.approvalChatId, text: `Approve this carousel for ${job.project.name}?`, reply_markup: replyMarkup })
    ).message_id;

    await prisma.carouselApproval.upsert({
      where: { carouselJobId: job.id },
      update: { status: "PENDING", channel: "TELEGRAM", telegramChatId: tg.approvalChatId, telegramMessageId: String(messageId), note: "Sent to Telegram", decidedAt: null, decidedBy: null },
      create: { carouselJobId: job.id, channel: "TELEGRAM", telegramChatId: tg.approvalChatId, telegramMessageId: String(messageId), note: "Sent to Telegram" },
    });
  } finally {
    await Promise.all(tmpFiles.map((f) => fs.promises.rm(f, { force: true })));
  }
}

/** Failure alert to the team chat (never throws; respects Settings → notifications). */
export async function notifyTeam(text: string): Promise<void> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "notifyAdminOnFailure" } });
    if (setting && setting.value === false) return;
    const c = await getDecryptedCredentials("telegram");
    if (c?.status !== "CONNECTED" || !c.secrets.botToken || !c.config.approvalChatId) return;
    await telegram(c.secrets.botToken, "sendMessage", { chat_id: c.config.approvalChatId, text: `⚠️ Eki Control Center\n${scrubSecrets(text, [])}`.slice(0, 4000) });
  } catch {
    /* alerts are best effort */
  }
}
