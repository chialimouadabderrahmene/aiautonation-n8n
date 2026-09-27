import { getDecryptedCredentials } from "../lib/credentials";
import { storage } from "../lib/storage";

/**
 * Generic video-generation provider interface — adding a second provider
 * later (e.g. Pika, Luma) means implementing this once, not touching the
 * worker's orchestration logic.
 */
export interface VideoProvider {
  generateVideo(input: { prompt: string; durationSec: number; aspectRatio: string }): Promise<{ providerJobId: string }>;
  getJobStatus(providerJobId: string): Promise<{ status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"; outputUrl?: string; error?: string }>;
  cancelJob(providerJobId: string): Promise<void>;
}

const RUNWAY_API_BASE = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";

/**
 * NOT VERIFIED AGAINST A REAL RUNWAY ACCOUNT. Implemented against Runway's
 * publicly documented async task pattern (create → poll → fetch output),
 * using their text/image-to-video endpoint and version header. Runway's
 * exact request/response field names change between API versions — confirm
 * against https://docs.dev.runwayml.com before relying on this in
 * production, and update this file only (nothing else depends on Runway's
 * specific shapes).
 */
class RunwayVideoProvider implements VideoProvider {
  private async creds() {
    const c = await getDecryptedCredentials("runway");
    if (!c?.secrets.apiKey) throw new Error("Runway is not configured.");
    return c;
  }

  async generateVideo(input: { prompt: string; durationSec: number; aspectRatio: string }): Promise<{ providerJobId: string }> {
    const creds = await this.creds();
    const res = await fetch(`${RUNWAY_API_BASE}/text_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.secrets.apiKey}`,
        "X-Runway-Version": RUNWAY_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: creds.config.model || "gen3a_turbo",
        promptText: input.prompt,
        ratio: creds.config.aspectRatio || input.aspectRatio,
        duration: Math.min(10, Math.max(5, Math.round(input.durationSec))),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Runway responded ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id: string };
    return { providerJobId: data.id };
  }

  async getJobStatus(providerJobId: string) {
    const creds = await this.creds();
    const res = await fetch(`${RUNWAY_API_BASE}/tasks/${providerJobId}`, {
      headers: { Authorization: `Bearer ${creds.secrets.apiKey}`, "X-Runway-Version": RUNWAY_API_VERSION },
    });
    if (!res.ok) throw new Error(`Runway status check responded ${res.status}`);
    const data = (await res.json()) as { status: string; output?: string[]; failure?: string };
    const statusMap: Record<string, "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"> = {
      PENDING: "PENDING",
      THROTTLED: "PENDING",
      RUNNING: "RUNNING",
      SUCCEEDED: "SUCCEEDED",
      FAILED: "FAILED",
    };
    return {
      status: statusMap[data.status] ?? "RUNNING",
      outputUrl: data.output?.[0],
      error: data.failure,
    };
  }

  async cancelJob(providerJobId: string): Promise<void> {
    const creds = await this.creds();
    await fetch(`${RUNWAY_API_BASE}/tasks/${providerJobId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.secrets.apiKey}`, "X-Runway-Version": RUNWAY_API_VERSION },
    }).catch(() => undefined);
  }
}

export const videoProvider: VideoProvider = new RunwayVideoProvider();

const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

/** Creates a Runway scene job and polls it to completion, downloading the
 * result into local storage. Throws on failure or timeout — the caller
 * marks the individual scene FAILED without necessarily failing the whole
 * job (see index.ts). */
export async function generateSceneVideo(
  jobId: string,
  sceneIndex: number,
  input: { prompt: string; durationSec: number; aspectRatio: string },
): Promise<{ providerJobId: string; url: string }> {
  const { providerJobId } = await videoProvider.generateVideo(input);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const status = await videoProvider.getJobStatus(providerJobId);
    if (status.status === "SUCCEEDED" && status.outputUrl) {
      const res = await fetch(status.outputUrl);
      if (!res.ok) throw new Error(`Failed to download scene ${sceneIndex} output`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const url = await storage.save(`${jobId}/scene-${sceneIndex}.mp4`, buffer);
      return { providerJobId, url };
    }
    if (status.status === "FAILED") throw new Error(status.error ?? `Scene ${sceneIndex} generation failed`);
    if (Date.now() > deadline) throw new Error(`Scene ${sceneIndex} generation timed out`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
