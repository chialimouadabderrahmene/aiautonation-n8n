import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getDecryptedCredentials } from "../modules/integrations/vault";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

/** Authenticated actions (send to Telegram, read approval state). */
export const approvalsRouter = Router();
/** Public — Telegram calls this directly. Kept on a separate router so it
 * can never accidentally inherit an admin-only route mounted alongside it. */
export const approvalsPublicRouter = Router();

async function sendTelegramVideo(chatId: string, job: { id: string; finalVideoUrl: string | null; caption: string | null; project: { name: string } }) {
  const creds = await getDecryptedCredentials("telegram");
  if (!creds?.secrets.botToken) throw new Error("Telegram is not configured");

  const caption = `${job.project.name}\n\n${job.caption ?? ""}`.slice(0, 1024);
  const replyMarkup = {
    inline_keyboard: [[
      { text: "✅ Approve", callback_data: `approve:${job.id}` },
      { text: "❌ Reject", callback_data: `reject:${job.id}` },
    ]],
  };

  const body = job.finalVideoUrl
    ? { chat_id: chatId, video: job.finalVideoUrl, caption, reply_markup: replyMarkup }
    : { chat_id: chatId, text: `${caption}\n\n(no final video URL yet)`, reply_markup: replyMarkup };
  const method = job.finalVideoUrl ? "sendVideo" : "sendMessage";

  const res = await fetch(`https://api.telegram.org/bot${creds.secrets.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!data.ok) throw new Error(data.description ?? "Telegram send failed");
  return data.result?.message_id;
}

approvalsRouter.post("/video/:jobId/send", async (req: AuthedRequest, res) => {
  const job = await prisma.videoJob.findUnique({ where: { id: req.params.jobId }, include: { project: true } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "READY") return res.status(409).json({ message: "Video is not READY yet" });

  const creds = await getDecryptedCredentials("telegram");
  const chatId = creds?.secrets.approvalChatId;
  if (!chatId) return res.status(409).json({ message: "Telegram approval chat is not configured" });

  try {
    const messageId = await sendTelegramVideo(chatId, job);
    await prisma.approval.upsert({
      where: { videoJobId: job.id },
      update: { status: "PENDING", telegramChatId: chatId, telegramMessageId: String(messageId ?? ""), decidedAt: null, decidedBy: null },
      create: { videoJobId: job.id, telegramChatId: chatId, telegramMessageId: String(messageId ?? "") },
    });
    await recordAudit(req.admin?.email ?? "unknown", "approval.sent_to_telegram", "VideoJob", job.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : "Failed to send to Telegram" });
  }
});

approvalsRouter.get("/", async (_req, res) => {
  const approvals = await prisma.approval.findMany({
    include: { videoJob: { include: { project: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(approvals);
});

approvalsRouter.get("/video/:jobId", async (req, res) => {
  const approval = await prisma.approval.findUnique({ where: { videoJobId: req.params.jobId } });
  res.json(approval);
});

/**
 * Telegram webhook — public by necessity (Telegram calls it directly), but
 * gated by the same `X-Telegram-Bot-Api-Secret-Token` header pattern the
 * existing workflow 02 (content-approval) already uses. Only handles the
 * approve/reject inline-button callback for video approvals; everything else
 * is left to the existing n8n workflow 02.
 */
approvalsPublicRouter.post("/telegram/webhook", async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers["x-telegram-bot-api-secret-token"] !== expected) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const callback = req.body?.callback_query as { data?: string; from?: { username?: string; id?: number } } | undefined;
  if (!callback?.data) return res.json({ ok: true });

  const [action, videoJobId] = callback.data.split(":");
  if ((action !== "approve" && action !== "reject") || !videoJobId) return res.json({ ok: true });

  const approval = await prisma.approval.findUnique({ where: { videoJobId } });
  if (!approval) return res.json({ ok: true });

  await prisma.approval.update({
    where: { videoJobId },
    data: {
      status: action === "approve" ? "APPROVED" : "REJECTED",
      decidedAt: new Date(),
      decidedBy: callback.from?.username ?? String(callback.from?.id ?? "telegram"),
    },
  });
  await recordAudit("telegram", `video.${action}d`, "VideoJob", videoJobId);
  res.json({ ok: true });
});
