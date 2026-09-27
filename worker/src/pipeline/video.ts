import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { requireConnected } from "../lib/credentials";
import { timedFetch, readErrorDetail, withRetry, ProviderError, scrubSecrets } from "../lib/http";

/**
 * Runway adapter — real API, request/response shapes taken from Runway's
 * official SDK (@runwayml/sdk 4.x): base https://api.dev.runwayml.com,
 * header X-Runway-Version: 2024-11-06,
 *   POST /v1/text_to_video   { model, promptText (≤1000), ratio, duration }
 *   GET  /v1/tasks/{id}      status PENDING|THROTTLED|RUNNING|SUCCEEDED|FAILED|CANCELLED, output[] (expiring URLs)
 *   DELETE /v1/tasks/{id}    cancel/delete
 * Model constraints: gen4.5 → ratio 1280:720 | 720:1280, integer duration 2–10;
 * veo3.1 / veo3.1_fast → ratio adds 1080:1920 | 1920:1080, duration 4 | 6 | 8.
 */

const RUNWAY_API = "https://api.dev.runwayml.com/v1";
const RUNWAY_VERSION = "2024-11-06";

export interface VideoGenerationInput {
  prompt: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9" | string;
}

export interface VideoProvider {
  readonly name: string;
  createGeneration(input: VideoGenerationInput): Promise<{ taskId: string; model: string; ratio: string; duration: number; estimatedCredits?: number }>;
  getGeneration(taskId: string): Promise<{ status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED"; outputUrl?: string; error?: string; retryable?: boolean; progress?: number }>;
  cancelGeneration(taskId: string): Promise<void>;
}

export function runwayParams(model: string, aspectRatio: string, durationSec: number): { ratio: string; duration: number } {
  const vertical = aspectRatio !== "16:9";
  if (model.startsWith("veo")) {
    const allowed = [4, 6, 8];
    const duration = allowed.reduce((best, d) => (Math.abs(d - durationSec) < Math.abs(best - durationSec) ? d : best), 6);
    return { ratio: vertical ? "1080:1920" : "1920:1080", duration };
  }
  return { ratio: vertical ? "720:1280" : "1280:720", duration: Math.max(2, Math.min(10, Math.round(durationSec))) };
}

function runwayError(status: number, detail: string | undefined): ProviderError {
  const d = detail ? `: ${detail}` : "";
  if (status === 401) return new ProviderError(`Runway rejected the API key (401)${d}`, status, false);
  if (status === 403) return new ProviderError(`Runway denied the request (403)${d}`, status, false);
  if (status === 400) return new ProviderError(`Runway rejected the request (400)${d}`, status, false);
  if (status === 429) return new ProviderError(`Runway rate limit or out of credits (429)${d}`, status, true);
  if (status >= 500) return new ProviderError(`Runway is having problems (${status})${d}`, status, true);
  return new ProviderError(`Runway responded ${status}${d}`, status, false);
}

class RunwayVideoProvider implements VideoProvider {
  readonly name = "runway";

  private async creds() {
    return requireConnected("runway", "Runway");
  }

  private headers(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, "X-Runway-Version": RUNWAY_VERSION, "Content-Type": "application/json" };
  }

  async createGeneration(input: VideoGenerationInput) {
    const v = await this.creds();
    const model = v.model || "gen4.5";
    const { ratio, duration } = runwayParams(model, input.aspectRatio, input.durationSec);
    const body = { model, promptText: input.prompt.slice(0, 1000), ratio, duration, ...(model.startsWith("veo") ? { audio: false } : {}) };
    return withRetry(async () => {
      const { res } = await timedFetch(`${RUNWAY_API}/text_to_video`, { method: "POST", headers: this.headers(v.apiKey ?? ""), body: JSON.stringify(body) }, 30_000);
      if (!res.ok) throw runwayError(res.status, scrubSecrets((await readErrorDetail(res)) ?? "", [v.apiKey]));
      const data = (await res.json()) as { id: string; estimatedCost?: { credits?: number } };
      return { taskId: data.id, model, ratio, duration, estimatedCredits: data.estimatedCost?.credits };
    });
  }

  async getGeneration(taskId: string) {
    const v = await this.creds();
    return withRetry(async () => {
      const { res } = await timedFetch(`${RUNWAY_API}/tasks/${encodeURIComponent(taskId)}`, { headers: this.headers(v.apiKey ?? "") }, 20_000);
      if (!res.ok) throw runwayError(res.status, await readErrorDetail(res));
      const t = (await res.json()) as { status: string; output?: string[]; failure?: string; failureCode?: string; progress?: number };
      if (t.status === "SUCCEEDED") return { status: "SUCCEEDED" as const, outputUrl: t.output?.[0] };
      if (t.status === "FAILED") {
        // Moderation/input failures will fail again; internal ones are worth one more try.
        const retryable = Boolean(t.failureCode && /INTERNAL|TIMEOUT|ASSET/i.test(t.failureCode));
        return { status: "FAILED" as const, error: `Runway generation failed${t.failureCode ? ` [${t.failureCode}]` : ""}: ${t.failure ?? "no reason given"}`, retryable };
      }
      if (t.status === "CANCELLED") return { status: "CANCELLED" as const, error: "Runway task was cancelled" };
      if (t.status === "RUNNING") return { status: "RUNNING" as const, progress: t.progress };
      return { status: "PENDING" as const };
    });
  }

  async cancelGeneration(taskId: string) {
    const v = await this.creds().catch(() => null);
    if (!v) return;
    await timedFetch(`${RUNWAY_API}/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE", headers: this.headers(v.apiKey ?? "") }, 15_000).catch(() => undefined);
  }
}

export const videoProvider: VideoProvider = new RunwayVideoProvider();

const POLL_INTERVAL_MS = Number(process.env.RUNWAY_POLL_INTERVAL_MS ?? 5000);
const POLL_TIMEOUT_MS = Number(process.env.RUNWAY_POLL_TIMEOUT_MS ?? 15 * 60_000);

/**
 * Creates (or resumes polling of) a scene generation, waits for it, and
 * downloads the result to `destPath` immediately — Runway output URLs expire.
 * `isCancelled` is checked every poll; a cancelled job cancels the Runway task.
 */
export async function generateSceneClip(opts: {
  input: VideoGenerationInput;
  existingTaskId?: string | null;
  onTaskCreated: (taskId: string, meta: { model: string; ratio: string; duration: number; estimatedCredits?: number }) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  destPath: string;
}): Promise<{ taskId: string }> {
  let taskId = opts.existingTaskId ?? null;
  if (!taskId) {
    const created = await videoProvider.createGeneration(opts.input);
    taskId = created.taskId;
    await opts.onTaskCreated(taskId, created);
  }
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (await opts.isCancelled()) {
      await videoProvider.cancelGeneration(taskId);
      throw new CancelledError();
    }
    const status = await videoProvider.getGeneration(taskId);
    if (status.status === "SUCCEEDED") {
      if (!status.outputUrl) throw new ProviderError("Runway reported success without an output URL", null, true);
      const { res } = await timedFetch(status.outputUrl, {}, 120_000);
      if (!res.ok || !res.body) throw new ProviderError(`Downloading the Runway clip failed (${res.status})`, res.status, true);
      await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(opts.destPath));
      return { taskId };
    }
    if (status.status === "FAILED" || status.status === "CANCELLED") {
      throw new ProviderError(status.error ?? "Runway generation failed", null, Boolean(status.retryable));
    }
    if (Date.now() > deadline) {
      await videoProvider.cancelGeneration(taskId);
      throw new ProviderError(`Runway generation did not finish within ${Math.round(POLL_TIMEOUT_MS / 60000)} minutes`, null, true);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "CancelledError";
  }
}
