import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { enqueueVideoJob, getVideoQueue } from "../lib/queue";
import { getStorage } from "../lib/storage";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { evaluateRequirements, takeSnapshot } from "../modules/workflows/readiness";
import { VIDEO_PIPELINE_REQUIREMENTS, VIDEO_APPROVAL_REQUIREMENTS } from "../modules/workflows/manifest";
import { getSetting } from "../modules/settings/schema";

export const videoRouter = Router();

const ACTIVE_STATES = ["QUEUED", "SCRIPT_GENERATING", "STORYBOARD_READY", "VOICE_GENERATING", "VISUAL_GENERATING", "ASSEMBLING", "QUALITY_CHECK"] as const;

videoRouter.get("/readiness", async (_req, res) => {
  const snap = await takeSnapshot({ includeInfra: true });
  const [pipeline, approval] = await Promise.all([evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS, snap), evaluateRequirements(VIDEO_APPROVAL_REQUIREMENTS, snap)]);
  res.json({ ...pipeline, approval });
});

const PUBLISH_TARGETS = ["instagram", "facebook", "x", "linkedin"] as const;

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contentType: z.string().trim().min(1).max(60), // platform: Instagram Reel, TikTok, YouTube Short, LinkedIn, X...
  topic: z.string().trim().min(1).max(300),
  prompt: z.string().trim().min(1).max(2000),
  audience: z.string().trim().max(300).optional(),
  language: z.string().trim().min(2).max(40).default("en"),
  tone: z.string().trim().max(60).default("Professional"),
  durationSec: z.number().int().min(10).max(90).default(30),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  visualStyle: z.string().trim().max(120).default("Realistic"),
  voicePreset: z.string().trim().max(80).optional(),
  subtitles: z.boolean().default(true),
  musicFileId: z.string().optional(),
  brand: z.string().trim().max(60).default("Eki"),
  cta: z.string().trim().max(200).optional(),
  publishTargets: z.array(z.enum(PUBLISH_TARGETS)).max(4).default([]),
  /// Specific ConnectedAccount ids (multi-account distribution) — additive to publishTargets, see schema.prisma.
  publishAccountIds: z.array(z.string().cuid()).max(20).default([]),
});

async function attempts(): Promise<number> {
  return Number((await getSetting<number>("videoMaxAttempts")) ?? 2);
}

videoRouter.post("/projects", async (req: AuthedRequest, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  const readiness = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS);
  if (readiness.readiness !== "READY") {
    return res.status(409).json({ message: "Video pipeline is not READY", ...readiness });
  }
  const { musicFileId, ...data } = parsed.data;
  if (musicFileId && !(await prisma.mediaFile.findUnique({ where: { id: musicFileId } }))) {
    return res.status(400).json({ message: "Selected music track no longer exists" });
  }

  const project = await prisma.videoProject.create({
    data: { ...data, musicFileId: musicFileId ?? null, music: musicFileId ? "track" : "none", testMode: false },
  });
  const job = await prisma.videoJob.create({ data: { projectId: project.id, state: "QUEUED" } });
  await enqueueVideoJob(job.id, 0, await attempts());
  await recordAudit(req.admin?.email ?? "unknown", "video.project_created", "VideoProject", project.id, { name: project.name, jobId: job.id });
  res.status(201).json({ project, job });
});

videoRouter.get("/projects", async (_req, res) => {
  const projects = await prisma.videoProject.findMany({
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { approval: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(projects);
});

videoRouter.get("/jobs/:id", async (req, res) => {
  const id = String(req.params.id);
  const job = await prisma.videoJob.findUnique({
    where: { id },
    include: { project: true, scenes: { orderBy: { index: "asc" } }, assets: { orderBy: { createdAt: "asc" } }, approval: true, publications: true },
  });
  if (!job) return res.status(404).json({ message: "Not found" });

  // Short-lived signed URLs for playback/download; storage keys never leave as-is.
  const storage = getStorage();
  const sign = async (key: string | null, name?: string) => (key && storage.driver !== "none" ? storage.signedUrl(key, 3600, name).catch(() => null) : null);
  const finalAsset = job.assets.find((a) => a.type === "FINAL");
  res.json({
    ...job,
    finalVideoUrl: undefined,
    finalVideo: finalAsset
      ? {
          playUrl: await sign(finalAsset.url),
          downloadUrl: await sign(finalAsset.url, `${job.project.name.replace(/[^\w.-]+/g, "_")}.mp4`),
          durationSec: finalAsset.durationSec,
          width: finalAsset.width,
          height: finalAsset.height,
          sizeBytes: finalAsset.sizeBytes,
          metadata: finalAsset.metadata,
        }
      : null,
    assets: job.assets.map((a) => ({ ...a, url: undefined })),
    scenes: await Promise.all(job.scenes.map(async (s) => ({ ...s, sceneVideoUrl: undefined, previewUrl: await sign(s.sceneVideoUrl), voiceKey: undefined }))),
  });
});

videoRouter.post("/jobs/:id/cancel", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const job = await prisma.videoJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (!(ACTIVE_STATES as readonly string[]).includes(job.state)) {
    return res.status(409).json({ message: `Cannot cancel a job in state ${job.state}` });
  }
  await prisma.videoJob.update({ where: { id }, data: { state: "CANCELLED", completedAt: new Date(), error: "Cancelled by admin" } });
  // Remove it from the queue if it has not started; a running job sees the
  // CANCELLED state at its next checkpoint and stops (cancelling Runway tasks).
  const waiting = await getVideoQueue().getJobs(["waiting", "delayed"]);
  for (const j of waiting) if (j.data.videoJobId === id) await j.remove().catch(() => undefined);
  await recordAudit(req.admin?.email ?? "unknown", "video.job_cancelled", "VideoJob", id);
  res.json({ ok: true });
});

/** Resume a FAILED/CANCELLED job: stages that already completed (script,
 * voice per scene, visuals per scene) are reused, not re-billed. */
videoRouter.post("/jobs/:id/retry", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const job = await prisma.videoJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "FAILED" && job.state !== "CANCELLED") return res.status(409).json({ message: "Only a FAILED or CANCELLED job can be retried" });
  const readiness = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS);
  if (readiness.readiness !== "READY") return res.status(409).json({ message: "Video pipeline is not READY", ...readiness });

  const updated = await prisma.videoJob.update({
    where: { id },
    data: { state: "QUEUED", error: null, errorStage: null, completedAt: null, retryCount: { increment: 1 } },
  });
  await enqueueVideoJob(id, updated.retryCount, await attempts());
  await recordAudit(req.admin?.email ?? "unknown", "video.job_retried", "VideoJob", id, { retryCount: updated.retryCount });
  res.json({ ok: true });
});

const regenerateSchema = z.object({ prompt: z.string().trim().min(1).max(2000).optional(), note: z.string().trim().max(500).optional() });

/** After a REJECT: start a fresh job for the same project (optionally with an edited brief). */
videoRouter.post("/projects/:id/regenerate", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = regenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid body" });
  const project = await prisma.videoProject.findUnique({ where: { id } });
  if (!project) return res.status(404).json({ message: "Not found" });
  const readiness = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS);
  if (readiness.readiness !== "READY") return res.status(409).json({ message: "Video pipeline is not READY", ...readiness });

  const prompt = parsed.data.prompt ?? (parsed.data.note ? `${project.prompt}\n\nRevision request: ${parsed.data.note}` : project.prompt);
  if (prompt !== project.prompt) await prisma.videoProject.update({ where: { id }, data: { prompt } });
  const job = await prisma.videoJob.create({ data: { projectId: id, state: "QUEUED" } });
  await enqueueVideoJob(job.id, 0, await attempts());
  await recordAudit(req.admin?.email ?? "unknown", "video.regenerated", "VideoProject", id, { jobId: job.id });
  res.status(201).json({ job });
});
