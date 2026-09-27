/**
 * Worker self-test — proves the media toolchain on THIS machine/container:
 *   ffmpeg + ffprobe present → synthetic scene clips (different sizes/fps,
 *   like real provider output) + synthetic narration + music → the real
 *   assembleVideo() → the real qualityCheck() → upload to the configured
 *   storage → signed URL → delete.
 *
 * No provider is called and nothing is presented as AI output: the inputs
 * are FFmpeg test patterns. Run on a deployed worker with:
 *   node dist/tools/selftest.js            (add --keep to leave the MP4 in storage)
 * Exit code 0 = every check passed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, probe, binaryVersion, hasSubtitleFilter } from "../lib/ffmpeg";
import { assembleVideo, outputSize } from "../pipeline/assemble";
import { qualityCheck } from "../pipeline/qa";
import { getStorage } from "../lib/storage";

async function main() {
  const keep = process.argv.includes("--keep");
  const aspect = process.argv.includes("--landscape") ? "16:9" : "9:16";
  const report: Record<string, unknown> = {};
  report.ffmpeg = await binaryVersion("ffmpeg");
  report.ffprobe = await binaryVersion("ffprobe");
  report.subtitlesFilter = await hasSubtitleFilter();
  if (!report.ffmpeg || !report.ffprobe) throw new Error("ffmpeg/ffprobe not found on PATH");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eki-selftest-"));
  try {
    // Clips deliberately mismatched (sizes, fps, lengths) like real provider output.
    const clips = [
      { size: "720x1280", rate: 24, dur: 5, src: "testsrc2" },
      { size: "768x1280", rate: 30, dur: 4, src: "smptebars" },
      { size: "1080x1920", rate: 25, dur: 6, src: "mandelbrot" },
    ];
    const scenes = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i]!;
      const clipPath = path.join(dir, `clip-${i}.mp4`);
      await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `${c.src}=size=${c.size}:rate=${c.rate}`, "-t", String(c.dur), "-pix_fmt", "yuv420p", "-c:v", "libx264", clipPath]);
      // Narration longer than clip 1 to exercise the freeze-frame hold.
      const voiceDur = i === 1 ? 5.5 : c.dur - 1.2;
      const voicePath = path.join(dir, `voice-${i}.mp3`);
      await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=frequency=${300 + i * 150}:sample_rate=44100`, "-t", String(voiceDur), "-c:a", "libmp3lame", voicePath]);
      scenes.push({ clipPath, voicePath, voiceDurationSec: (await probe(voicePath)).durationSec, subtitleText: `Self-test scene ${i + 1}: subtitles are burned in and timed to the narration` });
    }
    const musicPath = path.join(dir, "music.mp3");
    await run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=110:sample_rate=44100", "-t", "7", "-c:a", "libmp3lame", musicPath]);

    const started = Date.now();
    const assembled = await assembleVideo({ workDir: dir, scenes, aspectRatio: aspect, subtitles: true, musicPath });
    report.assemblySeconds = Math.round((Date.now() - started) / 100) / 10;
    const size = outputSize(aspect);
    const qa = await qualityCheck(assembled.finalPath, { ...size, durationSec: assembled.durationSec, requestedSec: 15 });
    report.qa = { ok: qa.ok, issues: qa.issues, checks: qa.checks };
    report.output = qa.probe;

    const storage = getStorage();
    report.storageDriver = storage.driver;
    if (storage.driver !== "none") {
      const key = `_selftest/${Date.now()}-final.mp4`;
      const put = await storage.putFile(key, assembled.finalPath, "video/mp4");
      const back = path.join(dir, "roundtrip.mp4");
      await storage.downloadToFile(key, back);
      const same = (await fs.stat(back)).size === put.sizeBytes;
      report.storage = { key, uploadedBytes: put.sizeBytes, downloadMatches: same, signedUrl: (await storage.signedUrl(key, 600)).replace(/(Signature|X-Amz-Signature|sig)=[^&]+/g, "$1=…") };
      if (!keep) await storage.delete(key);
      if (!same) qa.ok = false;
    }
    console.log(JSON.stringify(report, null, 2));
    if (!qa.ok) process.exitCode = 1;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[selftest] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
