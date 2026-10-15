import IORedis from "ioredis";
import { prisma } from "../../lib/prisma";
import { getStorage, StorageCheck } from "../../lib/storage";

/**
 * Truthful system health for the Dashboard. Every component is checked for
 * real at request time (storage is cached for 60 s because its check writes
 * a probe object). Nothing is reported ONLINE without a successful check.
 */
export type HealthStatus = "ONLINE" | "OFFLINE" | "DEGRADED" | "NOT_CONFIGURED";

export interface ComponentHealth {
  status: HealthStatus;
  message: string;
  checkedAt: string;
  latencyMs?: number;
  lastSeenAt?: string | null;
  details?: Record<string, unknown>;
}

const STARTED_AT = new Date();
const WORKER_STALE_MS = 90_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

export async function checkDatabase(): Promise<ComponentHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const { ms } = await timed(() => prisma.$queryRaw`SELECT 1`);
    const migrations = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    return { status: "ONLINE", message: `PostgreSQL reachable, ${Number(migrations[0]?.count ?? 0)} migrations applied`, checkedAt, latencyMs: ms };
  } catch (err) {
    return { status: "OFFLINE", message: `Database unreachable: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`, checkedAt };
  }
}

export async function checkRedis(): Promise<ComponentHealth> {
  const checkedAt = new Date().toISOString();
  const url = process.env.REDIS_URL;
  if (!url) return { status: "NOT_CONFIGURED", message: "REDIS_URL is not set", checkedAt };
  const client = new IORedis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true, family: 0 });
  try {
    const { ms } = await timed(async () => {
      await client.connect();
      await client.ping();
    });
    return { status: "ONLINE", message: "Redis reachable", checkedAt, latencyMs: ms };
  } catch (err) {
    return { status: "OFFLINE", message: `Redis unreachable: ${err instanceof Error ? err.message : String(err)}`, checkedAt };
  } finally {
    client.disconnect();
  }
}

export async function checkWorker(): Promise<ComponentHealth> {
  const checkedAt = new Date().toISOString();
  const beats = await prisma.serviceHeartbeat.findMany({ where: { service: "worker" }, orderBy: { lastSeenAt: "desc" }, take: 5 });
  const live = beats.filter((b) => Date.now() - b.lastSeenAt.getTime() < WORKER_STALE_MS);
  if (live.length === 0) {
    return {
      status: "OFFLINE",
      message: beats[0] ? `No heartbeat since ${beats[0].lastSeenAt.toISOString()}` : "No video worker has ever reported in",
      checkedAt,
      lastSeenAt: beats[0]?.lastSeenAt.toISOString() ?? null,
    };
  }
  const caps = live[0]!.capabilities as { ffmpeg?: string | null; ffprobe?: string | null; storage?: StorageCheck; fonts?: boolean };
  const problems: string[] = [];
  if (!caps.ffmpeg) problems.push("ffmpeg missing");
  if (!caps.ffprobe) problems.push("ffprobe missing");
  if (caps.storage && !caps.storage.ok) problems.push(`storage: ${caps.storage.message}`);
  return {
    status: problems.length ? "DEGRADED" : "ONLINE",
    message: problems.length ? problems.join("; ") : `${live.length} worker(s) online — ${caps.ffmpeg}`,
    checkedAt,
    lastSeenAt: live[0]!.lastSeenAt.toISOString(),
    details: { instances: live.length, ffmpeg: caps.ffmpeg, ffprobe: caps.ffprobe, subtitleFonts: caps.fonts ?? null },
  };
}

/** True when a live worker reports working ffmpeg + ffprobe (readiness input). */
export async function workerHasFfmpeg(): Promise<boolean> {
  const w = await checkWorker();
  return w.status === "ONLINE";
}

export async function checkNativeAutomation(): Promise<ComponentHealth> {
  const checkedAt = new Date().toISOString();
  const workflows = await prisma.workflowConfig.count();
  const enabled = await prisma.workflowConfig.count({ where: { enabled: true } });
  return { status: "ONLINE", message: `Native automation engine configured — ${enabled}/${workflows} workflows enabled`, checkedAt, details: { workflows, enabled } };
}

let storageCache: { at: number; value: ComponentHealth } | null = null;

export async function checkStorage(force = false): Promise<ComponentHealth> {
  if (!force && storageCache && Date.now() - storageCache.at < 60_000) return storageCache.value;
  const checkedAt = new Date().toISOString();
  const s = getStorage();
  const start = Date.now();
  const result = await s.check();
  const value: ComponentHealth =
    s.driver === "none"
      ? { status: "NOT_CONFIGURED", message: result.message, checkedAt }
      : { status: result.ok ? (s.driver === "local" ? "DEGRADED" : "ONLINE") : "OFFLINE", message: result.message, checkedAt, latencyMs: Date.now() - start, details: { driver: s.driver } };
  storageCache = { at: Date.now(), value };
  return value;
}

export async function systemHealth() {
  const [database, redis, worker, nativeAutomation, storage] = await Promise.all([checkDatabase(), checkRedis(), checkWorker(), checkNativeAutomation(), checkStorage()]);
  const api: ComponentHealth = {
    status: "ONLINE",
    message: `API up since ${STARTED_AT.toISOString()}`,
    checkedAt: new Date().toISOString(),
    details: { startedAt: STARTED_AT.toISOString(), uptimeSec: Math.round(process.uptime()), version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.APP_VERSION ?? "dev" },
  };
  return { api, worker, database, redis, nativeAutomation, storage };
}
