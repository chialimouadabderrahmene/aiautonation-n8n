import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker, Job, UnrecoverableError } from "bullmq";
import { prisma } from "./lib/prisma";
import { logger } from "./lib/logger";
import { getRedisConnection, VIDEO_QUEUE_NAME, DELIVERY_QUEUE_NAME, CAROUSEL_QUEUE_NAME, VideoGenerationJobPayload, DeliveryJobPayload, CarouselGenerationJobPayload } from "./lib/queue";
import { startHeartbeat, stopHeartbeat, currentCapabilities } from "./lib/heartbeat";
import { ProviderError, scrubSecrets } from "./lib/http";
import { processVideoJob, audit } from "./pipeline/orchestrator";
import { processCarouselJob, audit as carouselAudit } from "./pipeline/carousel-orchestrator";
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

  for (const w of [videoWorker, carouselWorker, deliveryWorker]) {
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
    await Promise.allSettled([videoWorker.close(), carouselWorker.close(), deliveryWorker.close()]);
    await stopHeartbeat();
    await prisma.$disconnect();
    healthServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  logger.info(`[worker] consuming ${VIDEO_QUEUE_NAME} + ${CAROUSEL_QUEUE_NAME} + ${DELIVERY_QUEUE_NAME}`);
}

process.on("unhandledRejection", (err) => logger.error({ err: err instanceof Error ? err.message : String(err) }, "unhandled rejection"));

main().catch(async (err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "[worker] fatal startup error");
  await notifyTeam(`Video worker failed to start: ${err instanceof Error ? err.message : String(err)}`).catch(() => undefined);
  process.exit(1);
});
