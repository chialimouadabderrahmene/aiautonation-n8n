import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker, Queue, Job, UnrecoverableError } from "bullmq";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import {
  getRedisConnection,
  VIDEO_QUEUE_NAME,
  DELIVERY_QUEUE_NAME,
  CAROUSEL_QUEUE_NAME,
  WHATSAPP_NURTURE_QUEUE_NAME,
  WHATSAPP_WELCOME_QUEUE_NAME,
  WHATSAPP_ENGAGEMENT_QUEUE_NAME,
  WEEKLY_REPORT_QUEUE_NAME,
  CONTENT_MULTIPLICATION_QUEUE_NAME,
  AUTOPILOT_CONTROLLER_QUEUE_NAME,
  VideoGenerationJobPayload,
  DeliveryJobPayload,
  CarouselGenerationJobPayload,
  WhatsAppNurtureJobPayload,
  WeeklyReportJobPayload,
  ContentMultiplicationJobPayload,
  AutopilotControllerJobPayload,
} from "./lib/queue";
import { startHeartbeat, stopHeartbeat, currentCapabilities } from "./lib/heartbeat";
import { ProviderError, scrubSecrets } from "./lib/http";
import { processVideoJob, audit } from "./pipeline/orchestrator";
import { processCarouselJob, audit as carouselAudit } from "./pipeline/carousel-orchestrator";
import { runWhatsAppNurture } from "./pipeline/whatsapp-nurture";
import { runWhatsAppWelcome } from "./pipeline/whatsapp-welcome";
import { runWhatsAppEngagement } from "./pipeline/whatsapp-engagement";
import { runWeeklyReport, formatTelegramDigest } from "./pipeline/weekly-report";
import { multiplyContent } from "./pipeline/content-multiplication";
import { runAutopilotController, formatAutopilotDigest } from "./pipeline/autopilot-controller";
import { sendVideoForApproval, sendCarouselForApproval, notifyTeam } from "./delivery/telegram";
import { publishVideo } from "./delivery/publish";
import { publishCarousel } from "./delivery/publish-carousel";

/**
 * Eki video worker: consumes two BullMQ queues.
 *   video-generation  long jobs (concurrency VIDEO_WORKER_CONCURRENCY, default 1)
 *   video-delivery    Telegram approval sends + publishing (concurrency 2)
 * Retries are bounded by each job's `attempts` (set by the API from Settings);
 * non-retryable failures (bad key, moderation, QA) stop immediately.
 */

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn({ attempt }, "[worker] database not reachable yet, retrying in 2s");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Remove temp work dirs left behind by a crash (older than 2 h). */
async function cleanupStaleTemp(): Promise<void> {
  const tmp = os.tmpdir();
  for (const name of await fs.readdir(tmp).catch(() => [] as string[])) {
    if (!name.startsWith("eki-")) continue;
    const full = path.join(tmp, name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > 2 * 3600_000) await fs.rm(full, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Picks the right Publication unique key: per-account when the job targets a
 * specific ConnectedAccount, else the legacy per-(videoJob, provider) key. */
function publicationWhere(payload: { videoJobId: string; target: string; connectedAccountId?: string }) {
  return payload.connectedAccountId
    ? { videoJobId_connectedAccountId: { videoJobId: payload.videoJobId, connectedAccountId: payload.connectedAccountId } }
    : { videoJobId_target: { videoJobId: payload.videoJobId, target: payload.target } };
}

/** Same pattern as publicationWhere, for CarouselPublication's own unique keys. */
function carouselPublicationWhere(payload: { carouselJobId: string; target: string; connectedAccountId?: string }) {
  return payload.connectedAccountId
    ? { carouselJobId_connectedAccountId: { carouselJobId: payload.carouselJobId, connectedAccountId: payload.connectedAccountId } }
    : { carouselJobId_target: { carouselJobId: payload.carouselJobId, target: payload.target } };
}

async function processCarouselPublish(payload: Extract<DeliveryJobPayload, { kind: "publish-carousel" }>, job: Job<DeliveryJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const maxAttempts = job.opts.attempts ?? 1;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "VIDEO_WORKER", externalId: `${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: {
      source: "VIDEO_WORKER",
      externalId: `${job.id}#${attempt}`,
      trigger: `publish-carousel:${payload.target}`,
      provider: payload.target,
      relatedEntityType: "CarouselJob",
      relatedEntityId: payload.carouselJobId,
      retryCount: attempt,
      mode: payload.kind,
    },
  });
  const finish = (status: "SUCCESS" | "FAILED", error?: string) =>
    prisma.automationExecution.update({ where: { id: execution.id }, data: { status, finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error } });

  const where = carouselPublicationWhere(payload);
  try {
    await prisma.carouselPublication.update({ where, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
    const result = await publishCarousel(payload.carouselJobId, payload.target, payload.connectedAccountId);
    await prisma.carouselPublication.update({ where, data: { status: "PUBLISHED", externalId: result.externalId, externalUrl: result.externalUrl ?? null, error: null, publishedAt: new Date() } });
    await carouselAudit("carousel.published", payload.carouselJobId, { target: payload.target, connectedAccountId: payload.connectedAccountId, externalId: result.externalId });
    await finish("SUCCESS");
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    const retryable = err instanceof ProviderError ? err.retryable : false;
    const willRetry = retryable && attempt + 1 < maxAttempts;
    await finish("FAILED", message);
    await prisma.carouselPublication.update({ where, data: { status: willRetry ? "PENDING" : "FAILED", error: message } });
    await carouselAudit("carousel.publish_failed", payload.carouselJobId, { message, willRetry, target: payload.target });
    if (!willRetry) {
      await notifyTeam(`Publishing carousel to ${payload.target} failed: ${message}`);
      throw new UnrecoverableError(message);
    }
    throw err;
  }
}

async function processCarouselDelivery(payload: Extract<DeliveryJobPayload, { kind: "send-carousel-approval" }>, job: Job<DeliveryJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "VIDEO_WORKER", externalId: `${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "VIDEO_WORKER", externalId: `${job.id}#${attempt}`, trigger: "telegram:send-carousel-approval", provider: "telegram", relatedEntityType: "CarouselJob", relatedEntityId: payload.carouselJobId, retryCount: attempt, mode: payload.kind },
  });
  try {
    await sendCarouselForApproval(payload.carouselJobId);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() } });
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message } });
    await prisma.carouselApproval.updateMany({ where: { carouselJobId: payload.carouselJobId }, data: { note: `Telegram send failed: ${message}`.slice(0, 500) } });
    throw new UnrecoverableError(message);
  }
}

async function processDelivery(job: Job<DeliveryJobPayload>): Promise<void> {
  if (job.data.kind === "send-carousel-approval") return processCarouselDelivery(job.data, job);
  if (job.data.kind === "publish-carousel") return processCarouselPublish(job.data, job);
  const payload = job.data;
  const attempt = job.attemptsMade;
  const maxAttempts = job.opts.attempts ?? 1;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "VIDEO_WORKER", externalId: `${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: {
      source: "VIDEO_WORKER",
      externalId: `${job.id}#${attempt}`,
      trigger: payload.kind === "publish" ? `publish:${payload.target}` : "telegram:send-approval",
      provider: payload.kind === "publish" ? payload.target : "telegram",
      relatedEntityType: "VideoJob",
      relatedEntityId: payload.videoJobId,
      retryCount: attempt,
      mode: payload.kind,
    },
  });
  const finish = (status: "SUCCESS" | "FAILED", error?: string) =>
    prisma.automationExecution.update({ where: { id: execution.id }, data: { status, finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error } });

  try {
    if (payload.kind === "send-approval") {
      await sendVideoForApproval(payload.videoJobId);
      await audit("approval.sent_to_telegram", payload.videoJobId, { requestedBy: payload.requestedBy });
    } else {
      const where = publicationWhere(payload);
      await prisma.publication.update({ where, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
      const result = await publishVideo(payload.videoJobId, payload.target, payload.connectedAccountId);
      await prisma.publication.update({ where, data: { status: "PUBLISHED", externalId: result.externalId, externalUrl: result.externalUrl ?? null, error: null, publishedAt: new Date() } });
      await audit("video.published", payload.videoJobId, { target: payload.target, connectedAccountId: payload.connectedAccountId, externalId: result.externalId });
    }
    await finish("SUCCESS");
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    const retryable = err instanceof ProviderError ? err.retryable : false;
    const willRetry = retryable && attempt + 1 < maxAttempts;
    await finish("FAILED", message);
    if (payload.kind === "send-approval") {
      await prisma.approval.updateMany({ where: { videoJobId: payload.videoJobId }, data: { note: `${willRetry ? "Retrying — " : ""}Telegram send failed: ${message}`.slice(0, 500) } });
    } else {
      await prisma.publication.update({
        where: publicationWhere(payload),
        data: { status: willRetry ? "PENDING" : "FAILED", error: message },
      });
    }
    await audit(payload.kind === "publish" ? "video.publish_failed" : "approval.send_failed", payload.videoJobId, { message, willRetry, target: payload.kind === "publish" ? payload.target : undefined });
    if (!willRetry) {
      await notifyTeam(`${payload.kind === "publish" ? `Publishing to ${payload.target}` : "Sending for approval"} failed: ${message}`);
      throw new UnrecoverableError(message);
    }
    throw err;
  }
}

async function processWhatsAppNurture(job: Job<WhatsAppNurtureJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "AUTOMATION_ENGINE", externalId: `whatsapp-nurture:${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "AUTOMATION_ENGINE", externalId: `whatsapp-nurture:${job.id}#${attempt}`, trigger: `whatsapp-nurture:${job.data.trigger}`, provider: "whatsapp", retryCount: attempt, mode: "whatsapp-nurture" },
  });
  try {
    const summary = await runWhatsAppNurture();
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() },
    });
    if (summary.failed > 0 || summary.missingTemplates.length) {
      const parts = [`WhatsApp nurture: ${summary.sent} sent, ${summary.failed} failed (of ${summary.eligible} due)`];
      if (summary.missingTemplates.length) parts.push(`Missing approved templates: ${summary.missingTemplates.join(", ")} — configure them in Integrations.`);
      if (summary.firstError) parts.push(`First error: ${summary.firstError}`);
      await notifyTeam(parts.join("\n"));
    }
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message },
    });
    // Not connected / misconfigured is expected until the admin sets up WhatsApp — never alert-spam for that, same restraint as the rest of the delivery pipeline.
    if (!message.includes("is not connected")) await notifyTeam(`WhatsApp nurture run failed: ${message}`);
    throw err;
  }
}

async function processWeeklyReport(job: Job<WeeklyReportJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "AUTOMATION_ENGINE", externalId: `weekly-report:${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "AUTOMATION_ENGINE", externalId: `weekly-report:${job.id}#${attempt}`, trigger: `weekly-report:${job.data.trigger}`, retryCount: attempt, mode: "weekly-report" },
  });
  try {
    const analytics = await runWeeklyReport();
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() },
    });
    // Unlike the other scheduled jobs, this one's whole purpose is the
    // digest itself — it always sends, not just on failure/blockage.
    await notifyTeam(formatTelegramDigest(analytics));
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message },
    });
    await notifyTeam(`Weekly report failed: ${message}`);
    throw err;
  }
}

/** Shared by welcome/engagement — identical AUTOMATION_ENGINE logging + not-connected-is-expected restraint as processWhatsAppNurture. */
async function runWaSequenceJob(
  job: Job<WhatsAppNurtureJobPayload>,
  mode: string,
  run: () => Promise<{ sent: number; failed: number; eligible: number; missingTemplates: string[]; firstError?: string }>,
  label: string,
): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "AUTOMATION_ENGINE", externalId: `${mode}:${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "AUTOMATION_ENGINE", externalId: `${mode}:${job.id}#${attempt}`, trigger: `${mode}:${job.data.trigger}`, provider: "whatsapp", retryCount: attempt, mode },
  });
  try {
    const summary = await run();
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() } });
    if (summary.failed > 0 || summary.missingTemplates.length) {
      const parts = [`${label}: ${summary.sent} sent, ${summary.failed} failed (of ${summary.eligible} due)`];
      if (summary.missingTemplates.length) parts.push(`Missing approved templates: ${summary.missingTemplates.join(", ")} — configure them in Integrations.`);
      if (summary.firstError) parts.push(`First error: ${summary.firstError}`);
      await notifyTeam(parts.join("\n"));
    }
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message } });
    if (!message.includes("is not connected")) await notifyTeam(`${label} run failed: ${message}`);
    throw err;
  }
}

async function processWhatsAppWelcome(job: Job<WhatsAppNurtureJobPayload>): Promise<void> {
  await runWaSequenceJob(job, "whatsapp-welcome", runWhatsAppWelcome, "WhatsApp welcome sequence");
}

async function processWhatsAppEngagement(job: Job<WhatsAppNurtureJobPayload>): Promise<void> {
  await runWaSequenceJob(job, "whatsapp-engagement", runWhatsAppEngagement, "WhatsApp engagement follow-up");
}

async function processContentMultiplication(job: Job<ContentMultiplicationJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "AUTOMATION_ENGINE", externalId: `content-multiplication:${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "AUTOMATION_ENGINE", externalId: `content-multiplication:${job.id}#${attempt}`, trigger: "content-multiplication:manual", retryCount: attempt, mode: "content-multiplication" },
  });
  try {
    const { variantsCreated } = await multiplyContent(job.data.idea);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() } });
    await notifyTeam(`Content multiplied: "${job.data.idea.slice(0, 80)}" -> ${variantsCreated} variants ready for review.`);
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message } });
    await notifyTeam(`Content multiplication failed for "${job.data.idea.slice(0, 80)}": ${message}`);
    throw err;
  }
}

async function processAutopilotController(job: Job<AutopilotControllerJobPayload>): Promise<void> {
  const attempt = job.attemptsMade;
  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "AUTOMATION_ENGINE", externalId: `autopilot-controller:${job.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: { source: "AUTOMATION_ENGINE", externalId: `autopilot-controller:${job.id}#${attempt}`, trigger: `autopilot-controller:${job.data.trigger}`, retryCount: attempt, mode: "autopilot-controller" },
  });
  try {
    const summary = await runAutopilotController();
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() } });
    await notifyTeam(formatAutopilotDigest(summary));
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message } });
    await notifyTeam(`Autopilot controller run failed: ${message}`);
    throw err;
  }
}

let isShuttingDown = false;

async function main() {
  if (!process.env.AUTOMATION_SECRET_KEY || process.env.AUTOMATION_SECRET_KEY.length < 32) {
    throw new Error("AUTOMATION_SECRET_KEY must be set (same value as the API)");
  }
  await waitForDatabase();
  await cleanupStaleTemp();
  await startHeartbeat();

  const videoWorker = new Worker<VideoGenerationJobPayload>(VIDEO_QUEUE_NAME, processVideoJob, {
    connection: getRedisConnection(),
    concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1),
    // Long provider polls: extend the lock so healthy jobs are not considered stalled.
    lockDuration: 5 * 60_000,
    maxStalledCount: 2,
  });
  const carouselWorker = new Worker<CarouselGenerationJobPayload>(CAROUSEL_QUEUE_NAME, processCarouselJob, {
    connection: getRedisConnection(),
    concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1),
    lockDuration: 3 * 60_000,
  });
  const deliveryWorker = new Worker<DeliveryJobPayload>(DELIVERY_QUEUE_NAME, processDelivery, {
    connection: getRedisConnection(),
    concurrency: 2,
    lockDuration: 10 * 60_000,
  });
  const whatsappNurtureWorker = new Worker<WhatsAppNurtureJobPayload>(WHATSAPP_NURTURE_QUEUE_NAME, processWhatsAppNurture, {
    connection: getRedisConnection(),
    concurrency: 1,
    lockDuration: 5 * 60_000,
  });
  // Registers the daily 08:00 UTC sweep (native port of n8n workflow 19's
  // schedule trigger). BullMQ keys a repeatable job by its name+pattern, so
  // re-registering on every worker restart is a no-op, not a duplicate.
  const whatsappNurtureSchedule = new Queue<WhatsAppNurtureJobPayload>(WHATSAPP_NURTURE_QUEUE_NAME, { connection: getRedisConnection() });
  await whatsappNurtureSchedule.add("run", { trigger: "scheduled" }, { repeat: { pattern: "0 8 * * *" }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });

  const weeklyReportWorker = new Worker<WeeklyReportJobPayload>(WEEKLY_REPORT_QUEUE_NAME, processWeeklyReport, {
    connection: getRedisConnection(),
    concurrency: 1,
    lockDuration: 5 * 60_000,
  });
  // Monday 09:00 UTC — same day/time as n8n workflow 09's schedule trigger.
  const weeklyReportSchedule = new Queue<WeeklyReportJobPayload>(WEEKLY_REPORT_QUEUE_NAME, { connection: getRedisConnection() });
  await weeklyReportSchedule.add("run", { trigger: "scheduled" }, { repeat: { pattern: "0 9 * * 1" }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });

  const whatsappWelcomeWorker = new Worker<WhatsAppNurtureJobPayload>(WHATSAPP_WELCOME_QUEUE_NAME, processWhatsAppWelcome, { connection: getRedisConnection(), concurrency: 1, lockDuration: 5 * 60_000 });
  // Daily 09:00 UTC — same time as n8n workflow 05's schedule trigger.
  const whatsappWelcomeSchedule = new Queue<WhatsAppNurtureJobPayload>(WHATSAPP_WELCOME_QUEUE_NAME, { connection: getRedisConnection() });
  await whatsappWelcomeSchedule.add("run", { trigger: "scheduled" }, { repeat: { pattern: "0 9 * * *" }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });

  const whatsappEngagementWorker = new Worker<WhatsAppNurtureJobPayload>(WHATSAPP_ENGAGEMENT_QUEUE_NAME, processWhatsAppEngagement, { connection: getRedisConnection(), concurrency: 1, lockDuration: 5 * 60_000 });
  // Daily 10:00 UTC — same time as n8n workflow 06's schedule trigger.
  const whatsappEngagementSchedule = new Queue<WhatsAppNurtureJobPayload>(WHATSAPP_ENGAGEMENT_QUEUE_NAME, { connection: getRedisConnection() });
  await whatsappEngagementSchedule.add("run", { trigger: "scheduled" }, { repeat: { pattern: "0 10 * * *" }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });

  // On-demand only (admin-triggered) — no repeatable schedule, native port of n8n workflow 18.
  const contentMultiplicationWorker = new Worker<ContentMultiplicationJobPayload>(CONTENT_MULTIPLICATION_QUEUE_NAME, processContentMultiplication, { connection: getRedisConnection(), concurrency: 1, lockDuration: 5 * 60_000 });

  const autopilotControllerWorker = new Worker<AutopilotControllerJobPayload>(AUTOPILOT_CONTROLLER_QUEUE_NAME, processAutopilotController, { connection: getRedisConnection(), concurrency: 1, lockDuration: 5 * 60_000 });
  // Daily 08:00 UTC — same time as n8n workflow 14's schedule trigger.
  const autopilotControllerSchedule = new Queue<AutopilotControllerJobPayload>(AUTOPILOT_CONTROLLER_QUEUE_NAME, { connection: getRedisConnection() });
  await autopilotControllerSchedule.add("run", { trigger: "scheduled" }, { repeat: { pattern: "0 8 * * *" }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });

  for (const w of [
    videoWorker,
    carouselWorker,
    deliveryWorker,
    whatsappNurtureWorker,
    weeklyReportWorker,
    whatsappWelcomeWorker,
    whatsappEngagementWorker,
    contentMultiplicationWorker,
    autopilotControllerWorker,
  ]) {
    w.on("failed", (job, err) => logger.warn({ queue: w.name, jobId: job?.id, err: scrubSecrets(err.message, []) }, "[worker] job failed"));
    w.on("completed", (job) => logger.info({ queue: w.name, jobId: job.id }, "[worker] job completed"));
    // Redis connection errors: BullMQ reconnects by itself; never crash the process.
    w.on("error", (err) => logger.error({ queue: w.name, err: err.message }, "[worker] queue connection error"));
  }

  const redis = getRedisConnection();
  const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? process.env.PORT ?? 4101);
  const healthServer = http.createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    Promise.all([redis.ping().then(() => true).catch(() => false), prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)]).then(([redisOk, dbOk]) => {
      const caps = currentCapabilities();
      const ok = redisOk && dbOk && !isShuttingDown;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(
        JSON.stringify({ ok, redis: redisOk, database: dbOk, ffmpeg: caps?.ffmpeg ?? null, ffprobe: caps?.ffprobe ?? null, storage: caps?.storage.ok ?? false, shuttingDown: isShuttingDown }),
      );
    });
  });
  healthServer.listen(HEALTH_PORT, () => logger.info(`[worker] health check on :${HEALTH_PORT}/health`));

  // Graceful shutdown: stop taking jobs, let in-flight work reach a checkpoint.
  // Anything interrupted is picked up again after restart (stalled-job
  // recovery) and resumes from its last completed stage.
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[worker] ${signal} received, finishing in-flight jobs`);
    const timeout = setTimeout(() => process.exit(1), 60_000);
    timeout.unref();
    await Promise.allSettled([
      videoWorker.close(),
      carouselWorker.close(),
      deliveryWorker.close(),
      whatsappNurtureWorker.close(),
      whatsappNurtureSchedule.close(),
      weeklyReportWorker.close(),
      weeklyReportSchedule.close(),
      whatsappWelcomeWorker.close(),
      whatsappWelcomeSchedule.close(),
      whatsappEngagementWorker.close(),
      whatsappEngagementSchedule.close(),
      contentMultiplicationWorker.close(),
      autopilotControllerWorker.close(),
      autopilotControllerSchedule.close(),
    ]);
    await stopHeartbeat();
    await prisma.$disconnect();
    healthServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  logger.info(
    `[worker] consuming ${VIDEO_QUEUE_NAME} + ${CAROUSEL_QUEUE_NAME} + ${DELIVERY_QUEUE_NAME} + ${WHATSAPP_NURTURE_QUEUE_NAME} (daily 08:00 UTC) + ${WEEKLY_REPORT_QUEUE_NAME} (Monday 09:00 UTC) + ` +
      `${WHATSAPP_WELCOME_QUEUE_NAME} (daily 09:00 UTC) + ${WHATSAPP_ENGAGEMENT_QUEUE_NAME} (daily 10:00 UTC) + ${CONTENT_MULTIPLICATION_QUEUE_NAME} (on-demand) + ${AUTOPILOT_CONTROLLER_QUEUE_NAME} (daily 08:00 UTC)`,
  );
}

process.on("unhandledRejection", (err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, "unhandled rejection"));

main().catch(async (err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "[worker] fatal startup error");
  await notifyTeam(`Video worker failed to start: ${err instanceof Error ? err.message : String(err)}`).catch(() => undefined);
  process.exit(1);
});
