import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getVideoQueue } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { evaluateRequirements } from "../modules/workflows/readiness";

export const videoRouter = Router();

/** The video pipeline isn't an n8n workflow, so it isn't in WORKFLOW_MANIFEST
 * — it has its own readiness check, reusing the same evaluator. */
export const VIDEO_PIPELINE_REQUIREMENTS = ["openai|groq", "runway", "elevenlabs"];

videoRouter.get("/readiness", async (_req, res) => {
  res.json(await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS));
});

const createProjectSchema = z.object({
  name: z.string().min(1),
  contentType: z.string().min(1),
  topic: z.string().min(1),
  prompt: z.string().min(1),
  audience: z.string().optional(),
  language: z.string().default("en"),
  tone: z.string().default("Professional"),
  durationSec: z.number().int().min(15).max(60).default(30),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  visualStyle: z.string().default("Realistic"),
  voicePreset: z.string().optional(),
  music: z.string().default("none"),
  subtitles: z.boolean().default(true),
  brand: z.string().default("Eki"),
  cta: z.string().optional(),
  testMode: z.boolean().default(true),
});

videoRouter.post("/projects", async (req: AuthedRequest, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid project", issues: parsed.error.issues });

  const readiness = await evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS);
  if (readiness.readiness !== "READY") {
    return res.status(409).json({ message: "Video pipeline is not READY", ...readiness });
  }

  const project = await prisma.videoProject.create({ data: parsed.data });
  const job = await prisma.videoJob.create({ data: { projectId: project.id, state: "QUEUED" } });
  await getVideoQueue().add("generate", { videoJobId: job.id }, { attempts: 1 });

  await recordAudit(req.admin?.email ?? "unknown", "video.project_created", "VideoProject", project.id, { name: project.name });
  res.status(201).json({ project, job });
});

videoRouter.get("/projects", async (_req, res) => {
  const projects = await prisma.videoProject.findMany({
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });
  res.json(projects);
});

videoRouter.get("/jobs/:id", async (req, res) => {
  const id = req.params.id as string;
  const job = await prisma.videoJob.findUnique({
    where: { id },
    include: { project: true, scenes: { orderBy: { index: "asc" } }, assets: true, approval: true },
  });
  if (!job) return res.status(404).json({ message: "Not found" });
  res.json(job);
});

videoRouter.post("/jobs/:id/cancel", async (req: AuthedRequest, res) => {
  const id = req.params.id as string;
  const job = await prisma.videoJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state === "READY" || job.state === "FAILED" || job.state === "CANCELLED") {
    return res.status(409).json({ message: `Cannot cancel a job in state ${job.state}` });
  }
  await prisma.videoJob.update({ where: { id }, data: { state: "CANCELLED" } });
  await recordAudit(req.admin?.email ?? "unknown", "video.job_cancelled", "VideoJob", id);
  res.json({ ok: true });
});

/** Retry: re-enqueue from the beginning (per-stage retry needs stage-level
 * state kept by the worker; full-job retry is what's implemented here). */
videoRouter.post("/jobs/:id/retry", async (req: AuthedRequest, res) => {
  const id = req.params.id as string;
  const job = await prisma.videoJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (job.state !== "FAILED") return res.status(409).json({ message: "Only a FAILED job can be retried" });

  await prisma.videoJob.update({
    where: { id },
    data: { state: "QUEUED", error: null, errorStage: null, retryCount: { increment: 1 } },
  });
  await getVideoQueue().add("generate", { videoJobId: id }, { attempts: 1 });
  await recordAudit(req.admin?.email ?? "unknown", "video.job_retried", "VideoJob", id);
  res.json({ ok: true });
});
