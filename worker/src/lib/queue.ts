import IORedis from "ioredis";

// Keep in sync with api/src/lib/queue.ts — see the note there.
export const VIDEO_QUEUE_NAME = "video-generation";

export interface VideoGenerationJobPayload {
  videoJobId: string;
}

export function getRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set.");
  return new IORedis(url, { maxRetriesPerRequest: null });
}
