import { spawn } from "node:child_process";

/** Thin, typed wrappers around the ffmpeg/ffprobe binaries (installed in the worker image). */

export function run(cmd: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => {
      stderr += c.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export interface ProbeResult {
  formatName: string;
  durationSec: number;
  sizeBytes: number;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], 60_000);
  const j = JSON.parse(stdout) as {
    format: { format_name?: string; duration?: string; size?: string };
    streams: { codec_type: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; sample_rate?: string; channels?: number; duration?: string }[];
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const fps = (() => {
    const [n, d] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
    return n && d ? n / d : 0;
  })();
  return {
    formatName: j.format.format_name ?? "",
    durationSec: Number(j.format.duration ?? v?.duration ?? a?.duration ?? 0),
    sizeBytes: Number(j.format.size ?? 0),
    video: v ? { codec: v.codec_name ?? "", width: v.width ?? 0, height: v.height ?? 0, fps } : null,
    audio: a ? { codec: a.codec_name ?? "", sampleRate: Number(a.sample_rate ?? 0), channels: a.channels ?? 0 } : null,
  };
}

export async function binaryVersion(cmd: "ffmpeg" | "ffprobe"): Promise<string | null> {
  try {
    const { stdout } = await run(cmd, ["-version"], 10_000);
    return stdout.split("\n")[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function hasSubtitleFilter(): Promise<boolean> {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-filters"], 10_000);
    return /\bsubtitles\b/.test(stdout);
  } catch {
    return false;
  }
}
