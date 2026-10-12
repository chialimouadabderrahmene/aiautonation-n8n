import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Job, UnrecoverableError } from "bullmq";
import { Prisma, VideoJobState } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getStorage } from "../lib/storage";
import { probe } from "../lib/ffmpeg";
import { ProviderError, scrubSecrets } from "../lib/http";
import { logger } from "../lib/logger";
import { VideoGenerationJobPayload } from "../lib/queue";
import { generateScript } from "./script";
import { voiceProvider } from "./voice";
import { generateSceneClip, CancelledError } from "./video";
import { assembleVideo, outputSize } from "./assemble";
import { qualityCheck } from "./qa";
import { sendVideoForApproval, notifyTeam } from "../delivery/telegram";

/**
 * Asynchronous, resumable video generation. Every stage persists its output
 * (script + storyboard, one voice file per scene, one Runway clip per scene)
 * before moving on, so a retry — automatic or from the UI — resumes at the
 * failed stage and never pays twice for work that already succeeded.
 */

export async function audit(action: string, entityId: string, metadata?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { actor: "worker", action, entityType: "VideoJob", entityId, metadata: metadata as Prisma.InputJsonValue } }).catch(() => undefined);
}

async function isCancelled(jobId: string): Promise<boolean> {
  const j = await prisma.videoJob.findUnique({ where: { id: jobId }, select: { state: true } });
  return !j || j.state === "CANCELLED";
}

async function setStage(jobId: string, state: VideoJobState, progress: number, extra: Prisma.VideoJobUpdateInput = {}) {
  if (await isCancelled(jobId)) throw new CancelledError();
  await prisma.videoJob.update({ where: { id: jobId }, data: { state, progress, ...extra } });
}

export async function processVideoJob(bullJob: Job<VideoGenerationJobPayload>): Promise<void> {
  const { videoJobId } = bullJob.data;
  const initial = await prisma.videoJob.findUnique({ where: { id: videoJobId }, include: { project: true } });
  if (!initial || initial.state === "CANCELLED" || initial.state === "READY") return;
  const project = initial.project;
  const attempt = bullJob.attemptsMade;
  const maxAttempts = bullJob.opts.attempts ?? 1;
  const storage = getStorage();

  const execution = await prisma.automationExecution.upsert({
    where: { source_externalId: { source: "VIDEO_WORKER", externalId: `${bullJob.id}#${attempt}` } },
    update: { status: "RUNNING", startedAt: new Date() },
    create: {
      source: "VIDEO_WORKER",
      externalId: `${bullJob.id}#${attempt}`,
      trigger: attempt > 0 ? "automatic retry" : initial.retryCount > 0 ? "manual retry" : "video.generate",
      provider: "openai/groq + elevenlabs + runway + ffmpeg",
      relatedEntityType: "VideoJob",
      relatedEntityId: videoJobId,
      retryCount: initial.retryCount + attempt,
      mode: "QUEUED",
    },
  });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `eki-video-${videoJobId}-`));
  let stage: VideoJobState = "SCRIPT_GENERATING";

  try {
    if (!initial.startedAt) await prisma.videoJob.update({ where: { id: videoJobId }, data: { startedAt: new Date() } });

    // ---------------------------------------------------------- 1. Script
    let scenes = await prisma.videoScene.findMany({ where: { jobId: videoJobId }, orderBy: { index: "asc" } });
    if (!initial.script || scenes.length === 0) {
      stage = "SCRIPT_GENERATING";
      await setStage(videoJobId, stage, 5, { error: null });
      const script = await generateScript({
        contentType: project.contentType,
        topic: project.topic,
        prompt: project.prompt,
        audience: project.audience,
        language: project.language,
        tone: project.tone,
        durationSec: project.durationSec,
        aspectRatio: project.aspectRatio,
        visualStyle: project.visualStyle,
        brand: project.brand,
        cta: project.cta,
      });
      await prisma.$transaction([
        prisma.videoScene.deleteMany({ where: { jobId: videoJobId } }),
        prisma.videoAsset.deleteMany({ where: { jobId: videoJobId } }),
        prisma.videoJob.update({
          where: { id: videoJobId },
          data: {
            script: script as unknown as Prisma.InputJsonValue,
            caption: script.caption,
            hashtags: script.hashtags,
            costMetadata: { script: { provider: script.provider, model: script.model }, brandReview: script.brandReview } as unknown as Prisma.InputJsonValue,
          },
        }),
        ...script.scenes.map((s) =>
          prisma.videoScene.create({
            data: { jobId: videoJobId, index: s.index, visualPrompt: s.visualPrompt, voiceoverText: s.voiceoverText, subtitleText: s.subtitleText, durationSec: s.durationSec },
          }),
        ),
      ]);
      scenes = await prisma.videoScene.findMany({ where: { jobId: videoJobId }, orderBy: { index: "asc" } });
      await setStage(videoJobId, "STORYBOARD_READY", 15, { storyboard: script.scenes as unknown as Prisma.InputJsonValue });
    }

    // ----------------------------------------------------- 2. Voice (per scene)
    stage = "VOICE_GENERATING";
    await setStage(videoJobId, stage, 18);
    for (const scene of scenes) {
      if (scene.voiceKey || !scene.voiceoverText) continue;
      const out = await voiceProvider.synthesize(scene.voiceoverText, project.voicePreset ?? undefined, project.language);
      const file = path.join(workDir, `voice-${scene.index}.mp3`);
      await fs.writeFile(file, out.audio);
      const p = await probe(file);
      const key = `jobs/${videoJobId}/voice/scene-${scene.index}.mp3`;
      const { sizeBytes } = await storage.putFile(key, file, "audio/mpeg");
      await prisma.videoScene.update({ where: { id: scene.id }, data: { voiceKey: key, voiceDurationSec: p.durationSec } });
      await prisma.videoAsset.create({
        data: {
          jobId: videoJobId, type: "VOICEOVER", provider: voiceProvider.name, providerJobId: out.requestId, url: key, mimeType: "audio/mpeg", sizeBytes,
          durationSec: p.durationSec, metadata: { sceneIndex: scene.index, voiceId: out.voiceId, model: out.model, characters: scene.voiceoverText.length },
        },
      });
      await setStage(videoJobId, stage, 18 + Math.round((17 * (scene.index + 1)) / scenes.length));
    }

    // --------------------------------------------------- 3. Visuals (per scene)
    stage = "VISUAL_GENERATING";
    await setStage(videoJobId, stage, 36);
    scenes = await prisma.videoScene.findMany({ where: { jobId: videoJobId }, orderBy: { index: "asc" } });
    for (const scene of scenes) {
      if (scene.status === "READY" && scene.sceneVideoUrl) continue;
      const resumeTask = scene.status === "GENERATING" ? scene.providerJobId : null;
      await prisma.videoScene.update({ where: { id: scene.id }, data: { status: "GENERATING", error: null, provider: "runway", ...(resumeTask ? {} : { providerJobId: null }) } });
      const clipPath = path.join(workDir, `scene-${scene.index}.mp4`);
      let meta: Record<string, unknown> = {};
      try {
        const { taskId } = await generateSceneClip({
          input: { prompt: `${scene.visualPrompt}. Style: ${project.visualStyle}.`, durationSec: scene.durationSec, aspectRatio: project.aspectRatio },
          existingTaskId: resumeTask,
          onTaskCreated: async (id, m) => {
            meta = m;
            await prisma.videoScene.update({ where: { id: scene.id }, data: { providerJobId: id } });
          },
          isCancelled: () => isCancelled(videoJobId),
          destPath: clipPath,
        });
        const p = await probe(clipPath);
        if (!p.video) throw new ProviderError(`Runway clip for scene ${scene.index} has no video stream`, null, true);
        const key = `jobs/${videoJobId}/scenes/scene-${scene.index}.mp4`;
        const { sizeBytes } = await storage.putFile(key, clipPath, "video/mp4");
        await prisma.videoScene.update({ where: { id: scene.id }, data: { status: "READY", sceneVideoUrl: key, completedAt: new Date() } });
        await prisma.videoAsset.create({
          data: {
            jobId: videoJobId, type: "SCENE", provider: "runway", providerJobId: taskId, url: key, mimeType: "video/mp4", sizeBytes,
            durationSec: p.durationSec, width: p.video.width, height: p.video.height, metadata: { sceneIndex: scene.index, ...meta } as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        // The Runway task is gone either way (failed, or cancelled by us): a
        // retry must create a new one rather than resume polling it.
        await prisma.videoScene.update({
          where: { id: scene.id },
          data:
            err instanceof CancelledError
              ? { status: "PENDING", providerJobId: null }
              : { status: "FAILED", error: scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 500), providerJobId: null },
        });
        throw err;
      }
      await setStage(videoJobId, stage, 36 + Math.round((40 * (scene.index + 1)) / scenes.length));
    }

    // ------------------------------------------------------------ 4. Assembly
    stage = "ASSEMBLING";
    await setStage(videoJobId, stage, 80);
    scenes = await prisma.videoScene.findMany({ where: { jobId: videoJobId }, orderBy: { index: "asc" } });
    const assemblyScenes = [];
    for (const s of scenes) {
      const clipPath = path.join(workDir, "in", `scene-${s.index}.mp4`);
      await storage.downloadToFile(s.sceneVideoUrl!, clipPath);
      let voicePath: string | null = null;
      if (s.voiceKey) {
        voicePath = path.join(workDir, "in", `voice-${s.index}.mp3`);
        await storage.downloadToFile(s.voiceKey, voicePath);
      }
      assemblyScenes.push({ clipPath, voicePath, voiceDurationSec: s.voiceDurationSec, subtitleText: s.subtitleText ?? s.voiceoverText ?? "" });
    }
    let musicPath: string | null = null;
    if (project.musicFileId) {
      const music = await prisma.mediaFile.findUnique({ where: { id: project.musicFileId } });
      if (music) {
        musicPath = path.join(workDir, "in", `music.${music.storageKey.split(".").pop()}`);
        await storage.downloadToFile(music.storageKey, musicPath);
      }
    }
    const assembled = await assembleVideo({ workDir, scenes: assemblyScenes, aspectRatio: project.aspectRatio, subtitles: project.subtitles, musicPath });

    // ------------------------------------------------------- 5. Quality check
    stage = "QUALITY_CHECK";
    await setStage(videoJobId, stage, 92);
    const size = outputSize(project.aspectRatio);
    const qa = await qualityCheck(assembled.finalPath, { ...size, durationSec: assembled.durationSec, requestedSec: project.durationSec });
    if (!qa.ok) throw new ProviderError(`Quality check failed: ${qa.issues.join("; ")}`, null, false);

    const finalKey = `jobs/${videoJobId}/final.mp4`;
    const { sizeBytes } = await storage.putFile(finalKey, assembled.finalPath, "video/mp4");
    await prisma.videoAsset.deleteMany({ where: { jobId: videoJobId, type: { in: ["FINAL", "SUBTITLES", "MUSIC"] } } });
    if (assembled.srtPath) {
      const srtKey = `jobs/${videoJobId}/subtitles.srt`;
      const srt = await storage.putFile(srtKey, assembled.srtPath, "text/plain");
      await prisma.videoAsset.create({ data: { jobId: videoJobId, type: "SUBTITLES", url: srtKey, mimeType: "text/plain", sizeBytes: srt.sizeBytes } });
    }
    await prisma.videoAsset.create({
      data: {
        jobId: videoJobId, type: "FINAL", provider: "ffmpeg", url: finalKey, mimeType: "video/mp4", sizeBytes,
        durationSec: qa.probe!.durationSec, width: qa.probe!.video!.width, height: qa.probe!.video!.height,
        metadata: { qa: qa.checks, fps: qa.probe!.video!.fps, videoCodec: qa.probe!.video!.codec, audioCodec: qa.probe!.audio!.codec, sceneDurations: assembled.sceneDurations, music: Boolean(musicPath), subtitles: Boolean(assembled.srtPath) },
      },
    });
    if (await isCancelled(videoJobId)) throw new CancelledError();
    await prisma.videoJob.update({ where: { id: videoJobId }, data: { state: "READY", progress: 100, finalVideoUrl: finalKey, completedAt: new Date(), error: null, errorStage: null } });
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), mode: "READY" },
    });
    await audit("video.job_ready", videoJobId, { durationSec: qa.probe!.durationSec, sizeBytes });

    // --------------------------------------------- 6. Send for approval (best effort)
    const tg = await prisma.integration.findUnique({ where: { provider: "telegram" } });
    if (tg?.status === "CONNECTED") {
      await sendVideoForApproval(videoJobId).catch(async (err) => {
        const message = scrubSecrets(err instanceof Error ? err.message : String(err), []);
        await prisma.approval.upsert({
          where: { videoJobId },
          update: { note: `Automatic Telegram send failed: ${message}`.slice(0, 500) },
          create: { videoJobId, note: `Automatic Telegram send failed: ${message}`.slice(0, 500) },
        });
      });
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "CANCELLED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), mode: stage } });
      await audit("video.job_cancel_observed", videoJobId, { stage });
      return;
    }
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 1000);
    const retryable = err instanceof ProviderError ? err.retryable : false;
    const willRetry = retryable && attempt + 1 < maxAttempts;
    await prisma.videoJob.update({
      where: { id: videoJobId },
      data: willRetry
        ? { state: "QUEUED", error: `Attempt ${attempt + 1}/${maxAttempts} failed at ${stage}, retrying automatically: ${message}`, errorStage: stage }
        : { state: "FAILED", error: message, errorStage: stage, completedAt: new Date() },
    });
    await prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: `${stage}: ${message}`, mode: stage },
    });
    await audit(willRetry ? "video.job_retry_scheduled" : "video.job_failed", videoJobId, { stage, message, attempt: attempt + 1, maxAttempts });
    logger.error({ videoJobId, stage, attempt: attempt + 1, willRetry, err: message }, "[worker] video job failed");
    if (!willRetry) await notifyTeam(`Video "${project.name}" FAILED at ${stage}: ${message}`);
    if (!willRetry) throw new UnrecoverableError(message);
    throw err;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
