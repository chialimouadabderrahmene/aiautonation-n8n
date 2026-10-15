import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { enqueueCarouselJob, enqueueDelivery } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { getSetting } from "../modules/settings/schema";

export const carouselsRouter = Router();

const targets = ["instagram", "facebook", "linkedin"] as const;
const createSchema = z.object({
  name: z.string().trim().min(1).max(120), topic: z.string().trim().min(1).max(300), prompt: z.string().trim().min(1).max(2000),
  audience: z.string().trim().max(300).optional(), language: z.string().trim().min(2).max(40).default("en"),
  tone: z.string().trim().max(60).default("Professional"), brand: z.string().trim().max(60).default("Eki"),
  cta: z.string().trim().max(200).optional(), slideCount: z.number().int().min(2).max(10).default(5),
  publishTargets: z.array(z.enum(targets)).max(3).default([]), campaignId: z.string().cuid().optional(),
});
const attempts = async () => Number((await getSetting<number>("videoMaxAttempts")) ?? 2);

carouselsRouter.post("/projects", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  if (await getSetting<boolean>("emergencyStop")) return res.status(409).json({ message: "Emergency stop is enabled; carousel was not enqueued" });
  if (parsed.data.campaignId && !(await prisma.campaign.findUnique({ where: { id: parsed.data.campaignId } }))) return res.status(400).json({ message: "Campaign not found" });
  const project = await prisma.carouselProject.create({ data: { ...parsed.data, audience: parsed.data.audience ?? null, cta: parsed.data.cta ?? null, campaignId: parsed.data.campaignId ?? null } });
  const job = await prisma.carouselJob.create({ data: { projectId: project.id, state: "QUEUED" } });
  await enqueueCarouselJob(job.id, 0, await attempts());
  await recordAudit(req.admin?.email ?? "unknown", "carousel.project_created", "CarouselProject", project.id, { jobId: job.id });
  res.status(201).json({ project, job });
});

carouselsRouter.get("/projects", async (_req, res) => res.json(await prisma.carouselProject.findMany({ include: { jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { approval: true, publications: true } } }, orderBy: { createdAt: "desc" }, take: 100 })));

carouselsRouter.get("/jobs/:id", async (req, res) => {
  const job = await prisma.carouselJob.findUnique({ where: { id: String(req.params.id) }, include: { project: true, slides: { orderBy: { index: "asc" } }, assets: { orderBy: { index: "asc" } }, approval: true, publications: true } });
  if (!job) return res.status(404).json({ message: "Not found" });
  res.json(job);
});

carouselsRouter.post("/jobs/:id/retry", async (req: AuthedRequest, res) => {
  const id = String(req.params.id); const job = await prisma.carouselJob.findUnique({ where: { id } });
  if (!job) return res.status(404).json({ message: "Not found" });
  if (!["FAILED", "CANCELLED"].includes(job.state)) return res.status(409).json({ message: "Only a FAILED or CANCELLED carousel can be retried" });
  const updated = await prisma.carouselJob.update({ where: { id }, data: { state: "QUEUED", error: null, completedAt: null, retryCount: { increment: 1 } } });
  await enqueueCarouselJob(id, updated.retryCount, await attempts());
  await recordAudit(req.admin?.email ?? "unknown", "carousel.job_retried", "CarouselJob", id, { retryCount: updated.retryCount });
  res.json({ ok: true });
});

carouselsRouter.post("/jobs/:id/send", async (req: AuthedRequest, res) => {
  const id = String(req.params.id); const job = await prisma.carouselJob.findUnique({ where: { id } });
  if (!job || job.state !== "READY") return res.status(409).json({ message: "Carousel is not READY" });
  await prisma.carouselApproval.upsert({ where: { carouselJobId: id }, update: { status: "PENDING", decidedAt: null, decidedBy: null, rejectionReason: null, note: "Sending to Telegram…" }, create: { carouselJobId: id, note: "Sending to Telegram…" } });
  await enqueueDelivery({ kind: "send-carousel-approval", carouselJobId: id, requestedBy: req.admin?.email ?? "unknown" });
  res.status(202).json({ ok: true });
});

async function currentCarouselHash(id: string) {
  const job = await prisma.carouselJob.findUnique({ where: { id }, include: { project: true, slides: { orderBy: { index: "asc" } } } });
  return job ? crypto.createHash("sha256").update(JSON.stringify({ project: { topic: job.project.topic, prompt: job.project.prompt, cta: job.project.cta }, slides: job.slides.map((s) => ({ index: s.index, headline: s.headline, body: s.body })) })).digest("hex") : null;
}

carouselsRouter.post("/jobs/:id/decision", async (req: AuthedRequest, res) => {
  const id = String(req.params.id); const parsed = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
  const job = await prisma.carouselJob.findUnique({ where: { id }, include: { approval: true, project: true } });
  if (!job || job.state !== "READY") return res.status(409).json({ message: "Only a READY carousel can be approved or rejected" });
  const hash = await currentCarouselHash(id);
  if (parsed.data.decision === "APPROVED" && job.approval?.contentHash && job.approval.contentHash !== hash) {
    await prisma.carouselApproval.update({ where: { carouselJobId: id }, data: { status: "PENDING", note: "Approval invalidated because carousel content changed", contentHash: hash } });
    return res.status(409).json({ message: "Approval is stale; review the changed carousel again" });
  }
  const approval = await prisma.carouselApproval.upsert({ where: { carouselJobId: id }, update: { status: parsed.data.decision, decidedAt: new Date(), decidedBy: req.admin?.email ?? "unknown", rejectionReason: parsed.data.decision === "REJECTED" ? parsed.data.reason ?? "Rejected" : null, contentHash: hash }, create: { carouselJobId: id, status: parsed.data.decision, decidedAt: new Date(), decidedBy: req.admin?.email ?? "unknown", rejectionReason: parsed.data.decision === "REJECTED" ? parsed.data.reason ?? "Rejected" : null, contentHash: hash } });
  await recordAudit(req.admin?.email ?? "unknown", parsed.data.decision === "APPROVED" ? "carousel.approved" : "carousel.rejected", "CarouselJob", id, { reason: parsed.data.reason });
  if (parsed.data.decision === "APPROVED") for (const target of job.project.publishTargets) { await prisma.carouselPublication.upsert({ where: { carouselJobId_target: { carouselJobId: id, target } }, update: { status: "PENDING", error: null }, create: { carouselJobId: id, target } }); await enqueueDelivery({ kind: "publish-carousel", carouselJobId: id, target, requestedBy: req.admin?.email ?? "unknown" }); }
  res.json(approval);
});

carouselsRouter.post("/jobs/:id/publish/:target/retry", async (req: AuthedRequest, res) => {
  const id = String(req.params.id), target = String(req.params.target); const pub = await prisma.carouselPublication.findUnique({ where: { carouselJobId_target: { carouselJobId: id, target } } });
  if (!pub) return res.status(404).json({ message: "Not found" }); if (pub.status !== "FAILED") return res.status(409).json({ message: "Only a FAILED publication can be retried" });
  await prisma.carouselPublication.update({ where: { id: pub.id }, data: { status: "PENDING", error: null } }); await enqueueDelivery({ kind: "publish-carousel", carouselJobId: id, target, requestedBy: req.admin?.email ?? "unknown" }, `retry-${pub.attempts + 1}`); res.json({ ok: true });
});
