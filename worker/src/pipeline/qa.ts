import fs from "node:fs/promises";
import { probe, run, ProbeResult } from "../lib/ffmpeg";

export interface QaResult {
  ok: boolean;
  issues: string[];
  probe: ProbeResult | null;
  checks: Record<string, boolean>;
}

/**
 * Real checks on the real output file — never a rubber stamp:
 * exists/non-empty, MP4 container, H.264 video at the exact expected size
 * and aspect ratio, AAC audio present, duration consistent with the
 * assembled timeline and the requested length, and a full decode pass with
 * no errors (i.e. the file actually plays).
 */
export async function qualityCheck(filePath: string, expected: { width: number; height: number; durationSec: number; requestedSec: number }): Promise<QaResult> {
  const issues: string[] = [];
  const checks: Record<string, boolean> = {};
  const stat = await fs.stat(filePath).catch(() => null);
  checks.exists = Boolean(stat && stat.size > 0);
  if (!checks.exists) return { ok: false, issues: ["Output file does not exist or is empty"], probe: null, checks };

  let p: ProbeResult;
  try {
    p = await probe(filePath);
  } catch (err) {
    return { ok: false, issues: [`ffprobe could not read the file: ${err instanceof Error ? err.message.slice(0, 300) : "unknown"}`], probe: null, checks };
  }

  checks.container = p.formatName.includes("mp4");
  if (!checks.container) issues.push(`Container is ${p.formatName}, expected MP4`);
  checks.video = Boolean(p.video && p.video.codec === "h264");
  if (!checks.video) issues.push(`Video stream missing or not H.264 (${p.video?.codec ?? "none"})`);
  checks.resolution = Boolean(p.video && p.video.width === expected.width && p.video.height === expected.height);
  if (!checks.resolution) issues.push(`Resolution ${p.video?.width}x${p.video?.height}, expected ${expected.width}x${expected.height}`);
  checks.aspectRatio = Boolean(p.video && Math.abs(p.video.width / p.video.height - expected.width / expected.height) < 0.01);
  if (!checks.aspectRatio) issues.push("Aspect ratio does not match the requested format");
  checks.audio = Boolean(p.audio && p.audio.codec === "aac");
  if (!checks.audio) issues.push(`Audio stream missing or not AAC (${p.audio?.codec ?? "none"})`);
  checks.duration = Math.abs(p.durationSec - expected.durationSec) <= 0.6 && p.durationSec >= expected.requestedSec * 0.5 && p.durationSec <= expected.requestedSec * 2.5;
  if (!checks.duration) issues.push(`Duration ${p.durationSec.toFixed(1)}s is inconsistent with the timeline (${expected.durationSec.toFixed(1)}s) or the requested ${expected.requestedSec}s`);

  try {
    const { stderr } = await run("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], 10 * 60_000);
    checks.decodes = stderr.trim().length === 0;
    if (!checks.decodes) issues.push(`Decode errors: ${stderr.trim().slice(0, 300)}`);
  } catch (err) {
    checks.decodes = false;
    issues.push(`Full decode failed: ${err instanceof Error ? err.message.slice(0, 300) : "unknown"}`);
  }
  return { ok: issues.length === 0, issues, probe: p, checks };
}
