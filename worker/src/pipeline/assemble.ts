import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { storage } from "../lib/storage";

/** Shells out to the `ffmpeg` binary — must be on PATH (installed in the
 * worker's Dockerfile; not present on this dev machine, so this path is
 * implemented but not yet locally exercised — see docs/VIDEO_PIPELINE.md). */
function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

function srtTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const msRemainder = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${msRemainder}`;
}

export function buildSrt(scenes: { subtitleText: string; durationSec: number }[]): string {
  let cursor = 0;
  return scenes
    .map((scene, i) => {
      const start = cursor;
      const end = cursor + scene.durationSec;
      cursor = end;
      return `${i + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(end)}\n${scene.subtitleText}\n`;
    })
    .join("\n");
}

export interface AssembleInput {
  jobId: string;
  sceneVideoUrls: string[]; // local file paths or file:// URLs from storage.save
  voiceoverPath: string;
  subtitlesSrt: string | null;
  musicPath?: string | null;
}

/**
 * Concatenates scene videos, mixes in the voiceover (and optional music bed),
 * and optionally burns in subtitles — producing one FINAL.mp4. Every input
 * path must already be a local file (the pipeline downloads provider outputs
 * before calling this).
 */
export async function assembleVideo(input: AssembleInput): Promise<{ localPath: string; url: string; workDir: string }> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `eki-video-${input.jobId}-`));
  const concatListPath = path.join(workDir, "concat.txt");
  const concatOutPath = path.join(workDir, "concatenated.mp4");
  const finalPath = path.join(workDir, "final.mp4");

  await fs.writeFile(
    concatListPath,
    input.sceneVideoUrls.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", concatOutPath]);

  let srtPath: string | null = null;
  if (input.subtitlesSrt) {
    srtPath = path.join(workDir, "subtitles.srt");
    await fs.writeFile(srtPath, input.subtitlesSrt);
  }

  const audioInputs = [input.voiceoverPath, ...(input.musicPath ? [input.musicPath] : [])];
  const filterComplex: string[] = [];
  const args: string[] = ["-y", "-i", concatOutPath];
  for (const audioPath of audioInputs) args.push("-i", audioPath);

  if (audioInputs.length > 1) {
    filterComplex.push(`[1:a][2:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
  }

  const videoFilter = srtPath ? `subtitles='${srtPath.replace(/\\/g, "/").replace(/:/g, "\\:")}'` : null;
  if (videoFilter) filterComplex.push(`[0:v]${videoFilter}[vout]`);

  if (filterComplex.length > 0) args.push("-filter_complex", filterComplex.join(";"));
  args.push("-map", videoFilter ? "[vout]" : "0:v");
  args.push("-map", audioInputs.length > 1 ? "[aout]" : "1:a");
  args.push("-shortest", "-c:v", "libx264", "-c:a", "aac", finalPath);

  await run("ffmpeg", args);

  const data = await fs.readFile(finalPath);
  const url = await storage.save(`${input.jobId}/final.mp4`, data);
  // Caller (index.ts) runs QA against `localPath` and is responsible for
  // removing `workDir` once it's done with it.
  return { localPath: finalPath, url, workDir };
}
