import fs from "node:fs/promises";
import path from "node:path";
import { run, probe } from "../lib/ffmpeg";

/**
 * Final assembly with FFmpeg:
 *   1. each scene clip is scaled/cropped to the exact output size, 30 fps,
 *      yuv420p, and held on its last frame while its narration finishes
 *   2. each scene's narration is padded with silence to the scene length
 *   3. scenes and narration are concatenated
 *   4. subtitles (timed to each scene's real narration) are burned in,
 *      an optional music bed is looped under the voice, and the result is
 *      encoded as H.264/AAC MP4 with +faststart (streams before fully downloaded)
 */

export interface AssemblyScene {
  clipPath: string;
  voicePath: string | null;
  voiceDurationSec: number | null;
  subtitleText: string;
}

export interface AssemblyInput {
  workDir: string;
  scenes: AssemblyScene[];
  aspectRatio: string;
  subtitles: boolean;
  musicPath: string | null;
  musicVolume?: number;
}

export interface AssemblyResult {
  finalPath: string;
  srtPath: string | null;
  width: number;
  height: number;
  durationSec: number;
  sceneDurations: number[];
}

export function outputSize(aspectRatio: string): { width: number; height: number } {
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`;
}

/** Splits text into readable caption chunks (≤ ~5 words / 30 chars, one line on vertical video). */
export function chunkCaption(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  for (const w of words) {
    const candidate = [...current, w].join(" ");
    if (current.length >= 5 || candidate.length > 30) {
      chunks.push(current.join(" "));
      current = [w];
    } else current.push(w);
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

/** SRT timed to the real narration of each scene; chunks share the spoken time by length. */
export function buildSrt(scenes: { subtitleText: string; startSec: number; speakSec: number }[]): string {
  const cues: string[] = [];
  let n = 1;
  for (const scene of scenes) {
    const chunks = chunkCaption(scene.subtitleText);
    const total = chunks.reduce((s, c) => s + c.length, 0) || 1;
    let t = scene.startSec + 0.05;
    for (const chunk of chunks) {
      const dur = Math.max(0.8, (scene.speakSec * chunk.length) / total);
      cues.push(`${n++}\n${srtTime(t)} --> ${srtTime(t + dur)}\n${chunk}\n`);
      t += dur;
    }
  }
  return cues.join("\n");
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function assembleVideo(input: AssemblyInput): Promise<AssemblyResult> {
  const { width, height } = outputSize(input.aspectRatio);
  const segDir = path.join(input.workDir, "segments");
  await fs.mkdir(segDir, { recursive: true });

  const sceneDurations: number[] = [];
  const videoList: string[] = [];
  const audioList: string[] = [];

  for (let i = 0; i < input.scenes.length; i++) {
    const scene = input.scenes[i]!;
    const clip = await probe(scene.clipPath);
    if (!clip.video) throw new Error(`Scene ${i} clip has no video stream`);
    const voice = scene.voiceDurationSec ?? 0;
    const duration = Math.max(clip.durationSec, voice > 0 ? voice + 0.35 : 0, 1);
    const hold = Math.max(0, duration - clip.durationSec + 0.1);
    sceneDurations.push(duration);

    const segVideo = path.join(segDir, `v${i}.mp4`);
    await run("ffmpeg", [
      "-y", "-v", "error", "-i", scene.clipPath,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,format=yuv420p,setsar=1,tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`,
      "-t", duration.toFixed(3), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", segVideo,
    ]);
    videoList.push(segVideo);

    const segAudio = path.join(segDir, `a${i}.wav`);
    if (scene.voicePath) {
      await run("ffmpeg", ["-y", "-v", "error", "-i", scene.voicePath, "-af", "apad", "-t", duration.toFixed(3), "-ar", "48000", "-ac", "2", segAudio]);
    } else {
      await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", duration.toFixed(3), segAudio]);
    }
    audioList.push(segAudio);
  }

  const vConcat = path.join(input.workDir, "video-list.txt");
  const aConcat = path.join(input.workDir, "audio-list.txt");
  await fs.writeFile(vConcat, videoList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  await fs.writeFile(aConcat, audioList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  const joinedVideo = path.join(input.workDir, "joined.mp4");
  const joinedAudio = path.join(input.workDir, "voice.wav");
  await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", vConcat, "-c", "copy", joinedVideo]);
  await run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", aConcat, "-c", "copy", joinedAudio]);
  const total = sceneDurations.reduce((s, d) => s + d, 0);

  let srtPath: string | null = null;
  if (input.subtitles) {
    let cursor = 0;
    const timings = input.scenes.map((s, i) => {
      const startSec = cursor;
      cursor += sceneDurations[i]!;
      return { subtitleText: s.subtitleText, startSec, speakSec: s.voiceDurationSec && s.voiceDurationSec > 0 ? s.voiceDurationSec : sceneDurations[i]! - 0.2 };
    });
    srtPath = path.join(input.workDir, "subtitles.srt");
    await fs.writeFile(srtPath, buildSrt(timings));
  }

  const finalPath = path.join(input.workDir, "final.mp4");
  const args = ["-y", "-v", "error", "-i", joinedVideo, "-i", joinedAudio];
  if (input.musicPath) args.push("-stream_loop", "-1", "-i", input.musicPath);
  const filters: string[] = [];
  let vOut = "0:v";
  if (srtPath) {
    const style = "FontName=DejaVu Sans,FontSize=11,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.4,Shadow=0,Alignment=2,MarginV=38";
    filters.push(`[0:v]subtitles='${escapeFilterPath(srtPath)}':force_style='${style}'[vout]`);
    vOut = "[vout]";
  }
  let aOut = "1:a";
  if (input.musicPath) {
    const vol = input.musicVolume ?? 0.12;
    const fadeStart = Math.max(0, total - 2).toFixed(2);
    filters.push(`[2:a]volume=${vol},afade=t=out:st=${fadeStart}:d=2[music]`);
    filters.push(`[1:a][music]amix=inputs=2:duration=first:normalize=0[aout]`);
    aOut = "[aout]";
  }
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  args.push(
    "-map", vOut, "-map", aOut,
    "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    finalPath,
  );
  await run("ffmpeg", args);
  return { finalPath, srtPath, width, height, durationSec: total, sceneDurations };
}
