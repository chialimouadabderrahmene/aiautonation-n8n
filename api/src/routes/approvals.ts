import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { enqueueDelivery } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { evaluateRequirements } from "../modules/workflows/readiness";
import { VIDEO_APPROVAL_REQUIREMENTS } from "../modules/workflows/manifest";
import { getTelegramWebhookSecret, secretsEqual, answerCallback, editDecisionMarkup } from "../modules/telegram/telegram";
import { getProviderValues } from "../modules/integrations/vault";
import { handleCarouselCallback } from "./carousel";
import { getN8nConnection } from "../modules/n8n/client";
import { timedFetch } from "../lib/http";
import { logger } from "../lib/logger";

/** Authenticated actions (send to Telegram, decide from the UI, list). */
export const approvalsRouter = Router();
/** Public — Telegram calls this directly; gated by the secret_token header. */
export const telegramPublicRouter = Router();

approvalsRouter.get("/", async (_req, res) => {
  const approvals = await prisma.approval.findMany({
    include: { videoJob: { include: { project: true, publications: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(approvals);
});

approvalsRouter.get("/video/:jobId", async (req, res) => {
  res.json(await prisma.approval.findUnique({ where: { videoJobId: String(req.params.jobId) } }));
});

approvalsRouter.post("/video/:jobId/send", async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId);
  const job = await prisma.videoJob.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "READY") return res.status(409).json({ message: "Video is not READY yet" });
  const readiness = await evaluateRequirements(VIDEO_APPROVAL_REQUIREMENTS);
  if (readiness.readiness !== "READY") return res.status(409).json({ message: "Telegram approval is not ready", ...readiness });

  await prisma.approval.upsert({
    where: { videoJobId: jobId },
    update: { status: "PENDING", decidedAt: null, decidedBy: null, rejectionReason: null, note: "Sending to Telegram…" },
    create: { videoJobId: jobId, note: "Sending to Telegram…" },
  });
  await enqueueDelivery({ kind: "send-approval", videoJobId: jobId, requestedBy: req.admin?.email ?? "unknown" });
  await recordAudit(req.admin?.email ?? "unknown", "approval.send_requested", "VideoJob", jobId);
  res.status(202).json({ ok: true, message: "Queued — the worker uploads the video to Telegram" });
});

const decideSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(500).optional() });

/** Record an approval decision (from Telegram or from the Control Center UI). */
export async function decide(videoJobId: string, decision: "APPROVED" | "REJECTED", decidedBy: string, reason?: string) {
  const approval = await prisma.approval.upsert({
    where: { videoJobId },
    update: { status: decision, decidedAt: new Date(), decidedBy, rejectionReason: decision === "REJECTED" ? reason ?? "Rejected" : null },
    create: { videoJobId, status: decision, decidedAt: new Date(), decidedBy, rejectionReason: decision === "REJECTED" ? reason ?? "Rejected" : null },
  });
  await recordAudit(decidedBy, decision === "APPROVED" ? "video.approved" : "video.rejected", "VideoJob", videoJobId, { reason });

  if (decision === "APPROVED") {
    const job = await prisma.videoJob.findUniqueOrThrow({ where: { id: videoJobId }, include: { project: true } });
    for (const target of job.project.publishTargets) {
      await prisma.publication.upsert({
        where: { videoJobId_target: { videoJobId, target } },
        update: { status: "PENDING", error: null },
        create: { videoJobId, target },
      });
      await enqueueDelivery({ kind: "publish", videoJobId, target, requestedBy: decidedBy });
    }
    // Multi-account distribution: one Publication + delivery job per
    // selected ConnectedAccount, independent of (and additive to) the
    // legacy per-provider targets above.
    if (job.project.publishAccountIds.length) {
      const connectedAccounts = await prisma.connectedAccount.findMany({ where: { id: { in: job.project.publishAccountIds } } });
      for (const account of connectedAccounts) {
        await prisma.publication.upsert({
          where: { videoJobId_connectedAccountId: { videoJobId, connectedAccountId: account.id } },
          update: { status: "PENDING", error: null },
          create: { videoJobId, target: account.provider, connectedAccountId: account.id },
        });
        await enqueueDelivery({ kind: "publish", videoJobId, target: account.provider, connectedAccountId: account.id, requestedBy: decidedBy });
      }
    }
  }
  return approval;
}

approvalsRouter.post("/video/:jobId/decision", async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId);
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
  const job = await prisma.videoJob.findUnique({ where: { id: jobId } });
  if (!job || job.state !== "READY") return res.status(409).json({ message: "Only a READY video can be approved or rejected" });
  const approval = await decide(jobId, parsed.data.decision, req.admin?.email ?? "unknown", parsed.data.reason);
  res.json(approval);
});

approvalsRouter.post("/video/:jobId/publish/:target/retry", async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId);
  const target = String(req.params.target);
  const pub = await prisma.publication.findUnique({ where: { videoJobId_target: { videoJobId: jobId, target } } });
  if (!pub) return res.status(404).json({ message: "Not found" });
  if (pub.status !== "FAILED") return res.status(409).json({ message: "Only a FAILED publication can be retried" });
  await prisma.publication.update({ where: { id: pub.id }, data: { status: "PENDING", error: null } });
  await enqueueDelivery({ kind: "publish", videoJobId: jobId, target, requestedBy: req.admin?.email ?? "unknown" });
  res.json({ ok: true });
});

/**
 * Telegram webhook. Video approval buttons (callback data `vid:approve:<id>`
 * / `vid:reject:<id>`) are handled here; every other update is forwarded to
 * n8n workflow 02 (content approval commands). Always answers 200 so
 * Telegram never retries forever.
 */
const telegramWebhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

telegramPublicRouter.post("/webhook", telegramWebhookLimiter, async (req, res) => {
  const header = req.headers["x-telegram-bot-api-secret-token"];
  const expected = await getTelegramWebhookSecret();
  if (typeof header !== "string" || !secretsEqual(header, expected)) return res.status(403).json({ message: "Forbidden" });
  res.json({ ok: true });

  try {
    const update = req.body as {
      callback_query?: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number } };
    };
    const cb = update.callback_query;
    if (cb?.data?.startsWith("car:")) {
      await handleCarouselCallback(cb);
      return;
    }
    const match = cb?.data?.match(/^vid:(approve|reject):([a-z0-9]+)$/);
    if (cb && match) {
      const telegram = await getProviderValues("telegram");
      const chatId = String(cb.message?.chat?.id ?? "");
      if (!telegram?.approvalChatId || chatId !== telegram.approvalChatId) {
        await answerCallback(cb.id, "Not allowed from this chat");
        return;
      }
      const [, action, jobId] = match as unknown as [string, "approve" | "reject", string];
      const job = await prisma.videoJob.findUnique({ where: { id: jobId }, include: { approval: true } });
      if (!job || job.state !== "READY") {
        await answerCallback(cb.id, "This video is no longer awaiting approval");
        return;
      }
      if (job.approval && job.approval.status !== "PENDING") {
        await answerCallback(cb.id, `Already ${job.approval.status.toLowerCase()}`);
        return;
      }
      const who = cb.from?.username ? `@${cb.from.username}` : `telegram:${cb.from?.id ?? "unknown"}`;
      await decide(jobId, action === "approve" ? "APPROVED" : "REJECTED", who, action === "reject" ? `Rejected in Telegram by ${who}` : undefined);
      await answerCallback(cb.id, action === "approve" ? "Approved ✅" : "Rejected ❌");
      if (cb.message?.message_id) await editDecisionMarkup(chatId, cb.message.message_id, action === "approve" ? `✅ Approved by ${who}` : `❌ Rejected by ${who}`);
      return;
    }
    if (cb?.data === "noop") {
      await answerCallback(cb.id, "Already decided");
      return;
    }

    // Everything else belongs to n8n workflow 02 (/approve, /reject, /edit commands).
    const conn = await getN8nConnection().catch(() => null);
    if (!conn) return;
    const { res: fwd } = await timedFetch(`${conn.baseUrl}/webhook/content-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": expected },
      body: JSON.stringify(req.body),
    });
    if (!fwd.ok && fwd.status !== 404) logger.warn({ status: fwd.status }, "[telegram] forward to n8n workflow 02 failed");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[telegram] webhook handling failed");
  }
});
