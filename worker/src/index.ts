import "dotenv/config";
import { Worker, Job } from "bullmq";
import { prisma } from "./lib/prisma";
import { getRedisConnection, VIDEO_QUEUE_NAME, VideoGenerationJobPayload } from "./lib/queue";
import { generateScript } from "./pipeline/script";
import { generateVoiceover } from "./pipeline/voice";
import { generateSceneVideo } from "./pipeline/video";
import { assembleVideo, buildSrt } from "./pipeline/assemble";
import { qualityCheck } from "./pipeline/qa";
import fs from "node:fs/promises";

async function isCancelled(jobId: string): Promise<boolean> {
  const job = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { state: true } });
  return job?.state === "CANCELLED";
}

async function setState(jobId: string, state: string, extra: Record<string, unknown> = {}): Promise<void> {
  await prisma.videoJob.update({ where: { id: jobId }, data: { state: state as never, ...extra } });
}

async function fail(jobId: string, stage: string, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.videoJob.update({
    where: { id: jobId },
    data: { state: "FAILED", error: message, errorStage: stage, completedAt: new Date() },
  });
  throw error instanceof Error ? error : new Error(message);
}

async function processVideoJob(bullJob: Job<VideoGenerationJobPayload>): Promise<void> {
  const { videoJobId } = bullJob.data;
  const execution = await prisma.automationExecution.create({
    data: { source: "VIDEO_WORKER", externalId: videoJobId, trigger: "video.create", status: "RUNNING", relatedEntityType: "VideoJob", relatedEntityId: videoJobId },
  });

  try {
    const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, include: { project: true } });
    if (!job) throw new Error(`VideoJob ${videoJobId} not found`);
    if (job.state === "CANCELLED") return;

    await prisma.videoJob.update({ where: { id: videoJobId }, data: { startedAt: new Date() } });

    // 1. Script
    await setState(videoJobId, "SCRIPT_GENERATING");
    const script = await generateScript({
      contentType: job.project.contentType,
      topic: job.project.topic,
      prompt: job.project.prompt,
      audience: job.project.audience,
      language: job.project.language,
      tone: job.project.tone,
      durationSec: job.project.durationSec,
      aspectRatio: job.project.aspectRatio,
      visualStyle: job.project.visualStyle,
      brand: job.project.brand,
      cta: job.project.cta,
    }).catch((err) => fail(videoJobId, "SCRIPT_GENERATING", err));

    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { script: script as unknown as object, caption: script.caption, hashtags: script.hashtags },
    });
    for (const scene of script.scenes) {
      await prisma.videoScene.create({
        data: {
          jobId: videoJobId,
          index: scene.index,
          visualPrompt: scene.visualPrompt,
          voiceoverText: scene.voiceoverText,
          subtitleText: scene.subtitleText,
          durationSec: Math.round(scene.durationSec),
        },
      });
    }
    await setState(videoJobId, "STORYBOARD_READY", { storyboard: script.scenes as unknown as object });
    if (await isCancelled(videoJobId)) return;

    // 2. Voiceover
    await setState(videoJobId, "VOICE_GENERATING");
    const fullNarration = script.scenes.map((s) => s.voiceoverText).join(" ");
    const voiceoverUrl = await generateVoiceover(videoJobId, fullNarration, job.project.voicePreset ?? undefined).catch((err) =>
      fail(videoJobId, "VOICE_GENERATING", err),
    );
    await prisma.videoAsset.create({ data: { jobId: videoJobId, type: "VOICEOVER", provider: "elevenlabs", url: voiceoverUrl } });
    if (await isCancelled(videoJobId)) return;

    // 3. Visual scenes (sequential — Runway is polled per scene; parallelising
    // would need per-provider rate-limit awareness this pass doesn't have).
    await setState(videoJobId, "VISUAL_GENERATING");
    const sceneUrls: string[] = [];
    for (const scene of script.scenes) {
      try {
        const result = await generateSceneVideo(videoJobId, scene.index, {
          prompt: scene.visualPrompt,
          durationSec: scene.durationSec,
          aspectRatio: job.project.aspectRatio,
        });
        await prisma.videoScene.update({
          where: { jobId_index: { jobId: videoJobId, index: scene.index } },
          data: { status: "READY", provider: "runway", providerJobId: result.providerJobId, sceneVideoUrl: result.url, completedAt: new Date() },
        });
        sceneUrls.push(result.url);
        await prisma.videoAsset.create({ data: { jobId: videoJobId, type: "SCENE", provider: "runway", url: result.url } });
      } catch (err) {
        await prisma.videoScene.update({
          where: { jobId_index: { jobId: videoJobId, index: scene.index } },
          data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
        });
        await fail(videoJobId, "VISUAL_GENERATING", err);
      }
      if (await isCancelled(videoJobId)) return;
    }

    // 4. Assembly (+ subtitles, + music if configured)
    await setState(videoJobId, "ASSEMBLING");
    const srt = job.project.subtitles ? buildSrt(script.scenes.map((s) => ({ subtitleText: s.subtitleText, durationSec: s.durationSec }))) : null;
    const assembled = await assembleVideo({
      jobId: videoJobId,
      sceneVideoUrls: sceneUrls,
      voiceoverPath: voiceoverUrl,
      subtitlesSrt: srt,
      // Background/custom music upload is not implemented in this pass (see
      // docs/VIDEO_PIPELINE.md "Known limitations") — never pass a
      // non-file value like "background" to ffmpeg.
      musicPath: null,
    }).catch((err) => fail(videoJobId, "ASSEMBLING", err));
    if (srt) await prisma.videoAsset.create({ data: { jobId: videoJobId, type: "SUBTITLES", url: `${videoJobId}/subtitles.srt` } });

    // 5. Quality check — real checks against the real output file.
    await setState(videoJobId, "QUALITY_CHECK");
    const qa = await qualityCheck(assembled.localPath, job.project.durationSec);
    await fs.rm(assembled.workDir, { recursive: true, force: true }).catch(() => undefined);

    if (!qa.ok) {
      await fail(videoJobId, "QUALITY_CHECK", new Error(`Quality check failed: ${qa.issues.join("; ")}`));
    }

    await prisma.videoAsset.create({ data: { jobId: videoJobId, type: "FINAL", url: assembled.url, durationSec: qa.durationSec } });
    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: { state: "READY", finalVideoUrl: assembled.url, completedAt: new Date() },
    });

    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() },
    });
  } catch (err) {
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        durationMs: Date.now() - execution.startedAt.getTime(),
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

const worker = new Worker<VideoGenerationJobPayload>(VIDEO_QUEUE_NAME, processVideoJob, {
  connection: getRedisConnection(),
  concurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1),
});

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[worker] video job ${job.data.videoJobId} completed`);
});
worker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[worker] video job ${job?.data.videoJobId} failed:`, err.message);
});

// eslint-disable-next-line no-console
console.log("[eki-automation-worker] listening for video generation jobs");
