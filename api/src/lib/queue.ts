import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getSetting } from "../modules/settings/schema";

// NOTE: queue names and payload shapes are duplicated in
// worker/src/lib/queue.ts (separately deployed services) — keep in sync.

/** Long-running generation (script → voice → visuals → FFmpeg → QA). */
export const VIDEO_QUEUE_NAME = "video-generation";
export const CAROUSEL_QUEUE_NAME = "carousel-generation";
/** Short delivery jobs: send a finished video to Telegram, publish it. */
export const DELIVERY_QUEUE_NAME = "video-delivery";

export interface VideoGenerationJobPayload {
  videoJobId: string;
}
export interface CarouselGenerationJobPayload { carouselJobId: string }

export type DeliveryJobPayload =
  | { kind: "send-approval"; videoJobId: string; requestedBy: string }
  | { kind: "publish"; videoJobId: string; target: string; requestedBy: string }
  | { kind: "send-carousel-approval"; carouselJobId: string; requestedBy: string }
  | { kind: "publish-carousel"; carouselJobId: string; target: string; requestedBy: string };

let connection: IORedis | null = null;
let videoQueue: Queue<VideoGenerationJobPayload> | null = null;
let carouselQueue: Queue<CarouselGenerationJobPayload> | null = null;
let deliveryQueue: Queue<DeliveryJobPayload> | null = null;

function getConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set — the video queue needs Redis.");
    // family 0 = resolve IPv4 and IPv6 (Railway private networking is IPv6).
    connection = new IORedis(url, { maxRetriesPerRequest: null, family: 0 });
  }
  return connection;
}

export function getVideoQueue(): Queue<VideoGenerationJobPayload> {
  if (!videoQueue) videoQueue = new Queue<VideoGenerationJobPayload>(VIDEO_QUEUE_NAME, { connection: getConnection() });
  return videoQueue;
}
export function getCarouselQueue(): Queue<CarouselGenerationJobPayload> {
  if (!carouselQueue) carouselQueue = new Queue<CarouselGenerationJobPayload>(CAROUSEL_QUEUE_NAME, { connection: getConnection() });
  return carouselQueue;
}

export function getDeliveryQueue(): Queue<DeliveryJobPayload> {
  if (!deliveryQueue) deliveryQueue = new Queue<DeliveryJobPayload>(DELIVERY_QUEUE_NAME, { connection: getConnection() });
  return deliveryQueue;
}

/**
 * Enqueue a generation run. Automatic attempts come from Settings; the
 * worker checkpoints every stage in the database, so a retry resumes where
 * the failure happened instead of re-billing completed provider calls.
 * The BullMQ job id is unique per (videoJob, run) so a double click cannot
 * enqueue the same run twice.
 */
export async function enqueueVideoJob(videoJobId: string, run: number, attempts: number): Promise<void> {
  if (await getSetting<boolean>("emergencyStop")) throw new Error("Emergency stop is enabled; generation was not enqueued");
  await getVideoQueue().add(
    "generate",
    { videoJobId },
    {
      jobId: `${videoJobId}-run${run}`,
      attempts: Math.max(1, Math.min(5, attempts)),
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 7 * 86400 },
      removeOnFail: { age: 30 * 86400 },
    },
  );
}

export async function enqueueDelivery(payload: DeliveryJobPayload, dedupeSuffix?: string): Promise<void> {
  if (await getSetting<boolean>("emergencyStop")) throw new Error("Emergency stop is enabled; delivery was not enqueued");
  const contentId = "videoJobId" in payload ? payload.videoJobId : payload.carouselJobId;
  const destination = "target" in payload ? payload.target : "approval";
  await getDeliveryQueue().add(payload.kind, payload, {
    jobId: `${payload.kind}:${contentId}:${destination}:${dedupeSuffix ?? "current"}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 20_000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: { age: 30 * 86400 },
  });
}

export async function enqueueCarouselJob(carouselJobId: string, run: number, attempts: number): Promise<void> {
  if (await getSetting<boolean>("emergencyStop")) throw new Error("Emergency stop is enabled; carousel was not enqueued");
  await getCarouselQueue().add("generate", { carouselJobId }, { jobId: `${carouselJobId}-run${run}`, attempts: Math.max(1, Math.min(5, attempts)), backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 } });
}
