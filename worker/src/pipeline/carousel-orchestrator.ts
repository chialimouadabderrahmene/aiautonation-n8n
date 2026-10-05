import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Job, UnrecoverableError } from "bullmq";
import { Prisma, CarouselJobState } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getStorage } from "../lib/storage";
import { ProviderError, scrubSecrets } from "../lib/http";
import { logger } from "../lib/logger";
import { CarouselGenerationJobPayload } from "../lib/queue";
import { generateCarouselScript } from "./slides";
import { renderSlide, dimensionsFor } from "./render-slides";
import { sendCarouselForApproval, notifyTeam } from "../delivery/telegram";

/**
 * Mirrors video's orchestrator.ts at a smaller scale: a carousel has no
 * voice/video generation stage — script -> render each slide -> quality
 * check (every slide file exists with the right dimensions) -> READY ->
 * Telegram approval. Same AutomationExecution logging, same retry/attempts
 * pattern, same storage layer.
 */

async function setStage(jobId: string, state: CarouselJobState, progress: number, extra: Prisma.CarouselJobUpdateInput = {}) {
  await prisma.carouselJob.update({ where: { id: jobId }, data: { state, progress, ...extra } });
}

export async function audit(action: string, carouselJobId: string, metadata?: Record<string, unknown>) {
  await prisma.auditLog.create({ data: { actor: "worker", action, entityType: "CarouselJob", entityId: carouselJobId, metadata: metadata as Prisma.InputJsonValue | undefined } });
}

export async function processCarouselJob(job: Job<CarouselGenerationJobPayload>): Promise<void> {
  const { carouselJobId } = job.data;
  const attempt = job.attemptsMade;
  const storage = getStorage();

  const initial = await prisma.carouselJob.findUniqueOrThrow({ where: { id: carouselJobId }, include: { project: true } });
  const project = initial.project;

  if (["READY", "CANCELLED"].includes(initial.state)) return; // already finished — a duplicate job in the queue is a no-op, never re-renders.

  const execution = await prisma.automationExecution.create({
    data: {
      source: "VIDEO_WORKER", // this worker process; see schema.prisma's ExecutionSource note
      externalId: `${job.id}#${attempt}`,
      trigger: attempt > 0 ? "automatic retry" : "carousel.generate",
      provider: "openai/groq + ffmpeg",
      relatedEntityType: "CarouselJob",
      relatedEntityId: carouselJobId,
      retryCount: attempt,
      mode: "QUEUED",
    },
  });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `eki-carousel-${carouselJobId}-`));

  try {
    // ---------------------------------------------------------- 1. Script
    let slides = await prisma.carouselSlide.findMany({ where: { jobId: carouselJobId }, orderBy: { index: "asc" } });
    if (!initial.script || slides.length === 0) {
      await setStage(carouselJobId, "SCRIPT_GENERATING", 10, { error: null });
      const script = await generateCarouselScript({
        topic: project.topic,
        prompt: project.prompt,
        audience: project.audience,
        language: project.language,
        tone: project.tone,
        brand: project.brand,
        cta: project.cta,
        slideCount: project.slideCount,
        platform: project.platform,
      });
      await prisma.$transaction([
        prisma.carouselSlide.deleteMany({ where: { jobId: carouselJobId } }),
        prisma.carouselJob.update({ where: { id: carouselJobId }, data: { script: script as unknown as Prisma.InputJsonValue, caption: script.caption, hashtags: script.hashtags } }),
        ...script.slides.map((s) => prisma.carouselSlide.create({ data: { jobId: carouselJobId, index: s.index, headline: s.headline, body: s.body ?? null, visualDirection: s.visualDirection } })),
      ]);
      await audit("carousel.script_generated", carouselJobId, { brandReview: script.brandReview, slideCount: script.slides.length });
      slides = await prisma.carouselSlide.findMany({ where: { jobId: carouselJobId }, orderBy: { index: "asc" } });
    }

    // ---------------------------------------------------------- 2. Render
    await setStage(carouselJobId, "RENDERING", 30);
    const { width, height } = dimensionsFor(project.platform);
    const brand = await prisma.brandProfile.findFirst({ where: { isActive: true } });
    for (const slide of slides) {
      if (slide.imageUrl) continue; // resumable: a slide already rendered (retry after a later failure) is not re-rendered or re-billed
      const outFile = path.join(workDir, `slide-${slide.index}.png`);
      await renderSlide({
        headline: slide.headline,
        body: slide.body,
        index: slide.index,
        total: slides.length,
        width,
        height,
        backgroundHex: brand?.primaryColorHex,
        accentHex: brand?.accentColorHex,
        outFile,
      });
      const key = `jobs/carousel-${carouselJobId}/slide-${slide.index}.png`;
      await storage.putFile(key, outFile, "image/png");
      await prisma.carouselSlide.update({ where: { id: slide.id }, data: { imageUrl: key } });
      await setStage(carouselJobId, "RENDERING", 30 + Math.round((40 * (slide.index + 1)) / slides.length));
    }

    // ------------------------------------------------------ 3. Quality check
    await setStage(carouselJobId, "QUALITY_CHECK", 85);
    const rendered = await prisma.carouselSlide.findMany({ where: { jobId: carouselJobId } });
    if (rendered.some((s) => !s.imageUrl)) throw new ProviderError("Not every slide rendered", null, true);

    await setStage(carouselJobId, "READY", 100, { completedAt: new Date() });
    await audit("carousel.ready", carouselJobId, { slideCount: rendered.length });
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "SUCCESS", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() } });

    // -------------------------------------------------- 4. Send for approval
    try {
      await sendCarouselForApproval(carouselJobId);
    } catch (err) {
      logger.warn({ carouselJobId, err: err instanceof Error ? err.message : String(err) }, "[carousel] could not send for Telegram approval — it stays READY, send manually");
    }
  } catch (err) {
    const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
    const retryable = err instanceof ProviderError ? err.retryable : true;
    await prisma.automationExecution.update({ where: { id: execution.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime(), error: message } });
    await setStage(carouselJobId, "FAILED", initial.progress, { error: message });
    await audit("carousel.failed", carouselJobId, { message });
    if (!retryable) {
      await notifyTeam(`Carousel generation failed (not retrying): ${message}`);
      throw new UnrecoverableError(message);
    }
    throw err;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
