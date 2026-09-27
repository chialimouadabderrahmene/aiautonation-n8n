import { spawn } from "node:child_process";
import fs from "node:fs/promises";

function ffprobe(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,width,height",
      "-of", "json",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr || `ffprobe exited ${code}`))));
  });
}

export interface QaResult {
  ok: boolean;
  issues: string[];
  durationSec?: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
}

/** Real checks against the actual output file — never a rubber stamp. */
export async function qualityCheck(filePath: string, expectedMinDurationSec: number): Promise<QaResult> {
  const issues: string[] = [];

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size === 0) {
    return { ok: false, issues: ["Output file does not exist or is empty"], hasVideoStream: false, hasAudioStream: false };
  }

  let probe: { format: { duration?: string }; streams: { codec_type: string }[] };
  try {
    probe = JSON.parse(await ffprobe(filePath));
  } catch (err) {
    return {
      ok: false,
      issues: [`ffprobe failed: ${err instanceof Error ? err.message : "unknown error"}`],
      hasVideoStream: false,
      hasAudioStream: false,
    };
  }

  const hasVideoStream = probe.streams.some((s) => s.codec_type === "video");
  const hasAudioStream = probe.streams.some((s) => s.codec_type === "audio");
  const durationSec = probe.format.duration ? Number(probe.format.duration) : undefined;

  if (!hasVideoStream) issues.push("No video stream in output");
  if (!hasAudioStream) issues.push("No audio stream in output");
  if (!durationSec || durationSec < expectedMinDurationSec * 0.7) {
    issues.push(`Duration ${durationSec ?? "unknown"}s is far short of the expected ~${expectedMinDurationSec}s`);
  }

  return { ok: issues.length === 0, issues, durationSec, hasVideoStream, hasAudioStream };
}
