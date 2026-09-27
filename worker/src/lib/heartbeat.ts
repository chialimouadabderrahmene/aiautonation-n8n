import os from "node:os";
import fs from "node:fs";
import { prisma } from "./prisma";
import { binaryVersion, hasSubtitleFilter } from "./ffmpeg";
import { getStorage, StorageCheck } from "./storage";
import { logger } from "./logger";

/**
 * The worker proves its own capabilities (ffmpeg, ffprobe, subtitle filter,
 * fonts, storage) at start-up and every 5 minutes, and reports liveness every
 * 30 s. The API's Dashboard and readiness engine read this — a worker that
 * stops reporting is shown OFFLINE, never assumed healthy.
 */

const INSTANCE = process.env.RAILWAY_REPLICA_ID ?? os.hostname();
const ID = `worker:${INSTANCE}`;
const STARTED_AT = new Date();

interface Capabilities {
  ffmpeg: string | null;
  ffprobe: string | null;
  subtitlesFilter: boolean;
  fonts: boolean;
  storage: StorageCheck;
  checkedAt: string;
}

let caps: Capabilities | null = null;

async function detect(): Promise<Capabilities> {
  const [ffmpeg, ffprobe, subtitlesFilter, storage] = await Promise.all([binaryVersion("ffmpeg"), binaryVersion("ffprobe"), hasSubtitleFilter(), getStorage().check()]);
  const fonts = ["/usr/share/fonts/dejavu", "/usr/share/fonts/ttf-dejavu", "/usr/share/fonts/truetype/dejavu"].some((d) => fs.existsSync(d));
  return { ffmpeg, ffprobe, subtitlesFilter, fonts, storage, checkedAt: new Date().toISOString() };
}

export function currentCapabilities(): Capabilities | null {
  return caps;
}

async function beat(): Promise<void> {
  await prisma.serviceHeartbeat.upsert({
    where: { id: ID },
    update: { lastSeenAt: new Date(), capabilities: (caps ?? {}) as object },
    create: { id: ID, service: "worker", instance: INSTANCE, startedAt: STARTED_AT, lastSeenAt: new Date(), capabilities: (caps ?? {}) as object },
  });
}

export async function startHeartbeat(): Promise<void> {
  caps = await detect();
  logger.info({ ffmpeg: caps.ffmpeg, ffprobe: caps.ffprobe, subtitles: caps.subtitlesFilter, fonts: caps.fonts, storage: caps.storage.message }, "[worker] capabilities");
  await beat().catch((err) => logger.warn({ err: String(err) }, "[worker] heartbeat failed"));
  setInterval(() => void beat().catch((err) => logger.warn({ err: String(err) }, "[worker] heartbeat failed")), 30_000).unref();
  // Re-detect every 5 minutes, or every 30 s while something is failing
  // (e.g. the bucket appeared after the worker started).
  let lastDetect = Date.now();
  setInterval(async () => {
    const failing = !caps?.ffmpeg || !caps?.ffprobe || !caps?.storage.ok;
    if (!failing && Date.now() - lastDetect < 5 * 60_000) return;
    lastDetect = Date.now();
    caps = await detect().catch(() => caps);
  }, 30_000).unref();
}

export async function stopHeartbeat(): Promise<void> {
  // Mark stale immediately so the Dashboard doesn't show a stopped worker as online for 90 s.
  await prisma.serviceHeartbeat.update({ where: { id: ID }, data: { lastSeenAt: new Date(0) } }).catch(() => undefined);
}
