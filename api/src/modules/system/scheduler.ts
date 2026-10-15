import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { refreshExpiringTokens } from "../oauth/oauth";
import { ensureTelegramWebhook } from "../telegram/telegram";
import { recomputeAllReadiness } from "../workflows/readiness";

/**
 * Background maintenance that makes the deployment self-configuring and
 * self-healing after every restart/redeploy — no human steps:
 *   - refresh expiring OAuth tokens
 *   - keep the Telegram webhook registered
 *   - recompute readiness so the Dashboard reflects reality
 * Each task is guarded so it never overlaps itself and never crashes the API.
 */

const running = new Set<string>();
const lastRun: Record<string, { at: string; ok: boolean; message?: string }> = {};

async function guard(name: string, fn: () => Promise<string | void>): Promise<void> {
  if (running.has(name)) return;
  running.add(name);
  try {
    const message = await fn();
    lastRun[name] = { at: new Date().toISOString(), ok: true, message: message || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastRun[name] = { at: new Date().toISOString(), ok: false, message };
    logger.warn({ task: name, err: message }, "[scheduler] task failed");
  } finally {
    running.delete(name);
  }
}

export function schedulerStatus() {
  return { lastRun };
}

export function startScheduler(): void {
  const every = (ms: number, name: string, fn: () => Promise<string | void>, initialDelay = 2000) => {
    setTimeout(() => {
      void guard(name, fn);
      setInterval(() => void guard(name, fn), ms).unref();
    }, initialDelay).unref();
  };

  every(5 * 60_000, "oauth-refresh", async () => {
    const refreshed = await refreshExpiringTokens();
    return refreshed.length ? `refreshed ${refreshed.join(", ")}` : "nothing to refresh";
  }, 20_000);
  every(10 * 60_000, "telegram-webhook", async () => (await ensureTelegramWebhook()).message, 25_000);
  every(60_000, "readiness", async () => {
    await recomputeAllReadiness();
  }, 5_000);
}
