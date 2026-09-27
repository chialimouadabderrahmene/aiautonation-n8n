import IORedis from "ioredis";

// Keep in sync with api/src/lib/queue.ts — see the note there.
export const VIDEO_QUEUE_NAME = "video-generation";
export const DELIVERY_QUEUE_NAME = "video-delivery";

export interface VideoGenerationJobPayload {
  videoJobId: string;
}

export type DeliveryJobPayload =
  | { kind: "send-approval"; videoJobId: string; requestedBy: string }
  | { kind: "publish"; videoJobId: string; target: string; requestedBy: string };

export function getRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set.");
  // family 0: resolve IPv4 + IPv6 (Railway private networking is IPv6).
  return new IORedis(url, { maxRetriesPerRequest: null, family: 0 });
}
