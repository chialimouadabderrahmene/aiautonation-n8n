import { Queue } from "bullmq";
import IORedis from "ioredis";

// NOTE: this queue name and job payload shape are duplicated in
// worker/src/lib/queue.ts (the two services are deployed independently, so
// they don't share a package) — keep them in sync if either changes.
export const VIDEO_QUEUE_NAME = "video-generation";

export interface VideoGenerationJobPayload {
  videoJobId: string;
}

let connection: IORedis | null = null;
let queue: Queue<VideoGenerationJobPayload> | null = null;

function getConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set — the video queue needs Redis.");
    connection = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return connection;
}

export function getVideoQueue(): Queue<VideoGenerationJobPayload> {
  if (!queue) {
    queue = new Queue<VideoGenerationJobPayload>(VIDEO_QUEUE_NAME, { connection: getConnection() });
  }
  return queue;
}
