import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { enqueueCarouselJob, enqueueDelivery } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { evaluateRequirements } from "../modules/workflows/readiness";
import { CAROUSEL_PIPELINE_REQUIREMENTS } from "../modules/workflows/manifest";
import { answerCallback, editDecisionMarkup, secretsEqual } from "../modules/telegram/telegram";
import { getProviderValues } from "../modules/integrations/vault";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";

export const carouselRouter = Router();

carouselRouter.get("/readiness", async (_req, res) => {
  res.json(await evaluateRequirements(CAROUSEL_PIPELINE_REQUIREMENTS));
});

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  topic: z.string().trim().min(1).max(300),
  prompt: z.string().trim().min(1).max(2000),
  audience: z.string().trim().max(300).optional(),
  language: z.string().trim().min(2).max(40).default("en"),
  tone: z.string().trim().max(60).default("Professional"),
  brand: z.string().trim().max(60).default("Eki"),
  cta: z.string().trim().max(200).optional(),
  slideCount: z.number().int().min(2).max(10).default(6),
  platform: z.enum(["instagram", "square", "linkedin", "story"]).default("instagram"),
  publishTargets: z.array(z.enum(["instagram", "facebook", "x", "linkedin"])).default([]),
  publishAccountIds: z.array(z.string()).default([]),
});

carouselRouter.post("/projects", async (req: AuthedRequest, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  const readiness = await evaluateRequirements(CAROUSEL_PIPELINE_REQUIREMENTS);
  if (readiness.readiness !== "READY") return res.status(409).json({ message: "Carousel pipeline is not READY", ...readiness });

  const project = await prisma.carouselProject.create({ data: parsed.data });
  const job = await prisma.carouselJob.create({ data: { projectId: project.id, state: "QUEUED" } });
  await enqueueCarouselJob(job.id, 0, 2);
  await recordAudit(req.admin?.email ?? "unknown", "carousel.project_created", "CarouselProject", project.id, { name: project.name, jobId: job.id });
  res.status(201).json({ project, job });
});

carouselRouter.get("/projects", async (_req, res) => {
  const projects = await prisma.carouselProject.findMany({
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1, include: { approval: true, slides: { orderBy: { index: "asc" } }, publications: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(projects);
});

carouselRouter.get("/jobs/:id", async (req, res) => {
  const job = await prisma.carouselJob.findUnique({ where: { id: String(req.params.id) }, include: { project: true, slides: { orderBy: { index: "asc" } }, approval: true, publications: true } });
  if (!job) return res.status(404).json({ message: "Not found" });
  res.json(job);
});

carouselRouter.get("/slides/:id/url", async (req, res) => {
  const slide = await prisma.carouselSlide.findUnique({ where: { id: String(req.params.id) } });
  if (!slide?.imageUrl) return res.status(404).json({ message: "Not found" });
  res.json({ url: await getStorage().signedUrl(slide.imageUrl, 900) });
});

carouselRouter.post("/jobs/:id/retry", async (req: AuthedRequest, res) => {
  const job = await prisma.carouselJob.findUnique({ where: { id: String(req.params.id) } });
  if (!job || job.state !== "FAILED") return res.status(409).json({ message: "Only a FAILED carousel job can be retried" });
  await prisma.carouselJob.update({ where: { id: job.id }, data: { state: "QUEUED", error: null } });
  await enqueueCarouselJob(job.id, 1, 2);
  await recordAudit(req.admin?.email ?? "unknown", "carousel.retry", "CarouselJob", job.id);
  res.status(202).json({ ok: true });
});

const decideSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(500).optional() });

export async function decideCarousel(carouselJobId: string, decision: "APPROVED" | "REJECTED", decidedBy: string, reason?: string) {
  const approval = await prisma.carouselApproval.upsert({
    where: { carouselJobId },
    update: { status: decision, decidedAt: new Date(), decidedBy, rejectionReason: decision === "REJECTED" ? reason ?? "Rejected" : null },
    create: { carouselJobId, status: decision, decidedAt: new Date(), decidedBy, rejectionReason: decision === "REJECTED" ? reason ?? "Rejected" : null },
  });
  await recordAudit(decidedBy, decision === "APPROVED" ? "carousel.approved" : "carousel.rejected", "CarouselJob", carouselJobId, { reason });

  if (decision === "APPROVED") {
    const job = await prisma.carouselJob.findUniqueOrThrow({ where: { id: carouselJobId }, include: { project: true } });
    for (const target of job.project.publishTargets) {
      await prisma.carouselPublication.upsert({
        where: { carouselJobId_target: { carouselJobId, target } },
        update: { status: "PENDING", error: null },
        create: { carouselJobId, target },
      });
      await enqueueDelivery({ kind: "publish-carousel", carouselJobId, target, requestedBy: decidedBy });
    }
    // Multi-account distribution: one CarouselPublication + delivery job per
    // selected ConnectedAccount — exact mirror of the video path in
    // approvals.ts's decide().
    if (job.project.publishAccountIds.length) {
      const connectedAccounts = await prisma.connectedAccount.findMany({ where: { id: { in: job.project.publishAccountIds } } });
      for (const account of connectedAccounts) {
        await prisma.carouselPublication.upsert({
          where: { carouselJobId_connectedAccountId: { carouselJobId, connectedAccountId: account.id } },
          update: { status: "PENDING", error: null },
          create: { carouselJobId, target: account.provider, connectedAccountId: account.id },
        });
        await enqueueDelivery({ kind: "publish-carousel", carouselJobId, target: account.provider, connectedAccountId: account.id, requestedBy: decidedBy });
      }
    }
  }
  return approval;
}

carouselRouter.post("/jobs/:id/publish/:target/retry", async (req: AuthedRequest, res) => {
  const carouselJobId = String(req.params.id);
  const target = String(req.params.target);
  const pub = await prisma.carouselPublication.findUnique({ where: { carouselJobId_target: { carouselJobId, target } } });
  if (!pub) return res.status(404).json({ message: "Not found" });
  if (pub.status !== "FAILED") return res.status(409).json({ message: "Only a FAILED publication can be retried" });
  await prisma.carouselPublication.update({ where: { id: pub.id }, data: { status: "PENDING", error: null } });
  await enqueueDelivery({ kind: "publish-carousel", carouselJobId, target, requestedBy: req.admin?.email ?? "unknown" });
  res.json({ ok: true });
});

carouselRouter.post("/jobs/:id/decision", async (req: AuthedRequest, res) => {
  const jobId = String(req.params.id);
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
  const job = await prisma.carouselJob.findUnique({ where: { id: jobId } });
  if (!job || job.state !== "READY") return res.status(409).json({ message: "Only a READY carousel can be approved or rejected" });
  const approval = await decideCarousel(jobId, parsed.data.decision, req.admin?.email ?? "unknown", parsed.data.reason);
  res.json(approval);
});

/** Shared with approvals.ts's Telegram webhook (car:approve|reject:<id> callback_data). */
export async function handleCarouselCallback(cb: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number } }): Promise<boolean> {
  const match = cb.data?.match(/^car:(approve|reject):([a-z0-9]+)$/);
  if (!match) return false;
  const telegram = await getProviderValues("telegram");
  const chatId = String(cb.message?.chat?.id ?? "");
  if (!telegram?.approvalChatId || !secretsEqual(chatId, telegram.approvalChatId)) {
    await answerCallback(cb.id, "Not allowed from this chat");
    return true;
  }
  const [, action, jobId] = match as unknown as [string, "approve" | "reject", string];
  const job = await prisma.carouselJob.findUnique({ where: { id: jobId }, include: { approval: true } });
  if (!job || job.state !== "READY") {
    await answerCallback(cb.id, "This carousel is no longer awaiting approval");
    return true;
  }
  if (job.approval && job.approval.status !== "PENDING") {
    await answerCallback(cb.id, `Already ${job.approval.status.toLowerCase()}`);
    return true;
  }
  const who = cb.from?.username ? `@${cb.from.username}` : `telegram:${cb.from?.id ?? "unknown"}`;
  await decideCarousel(jobId, action === "approve" ? "APPROVED" : "REJECTED", who, action === "reject" ? `Rejected in Telegram by ${who}` : undefined).catch((err) =>
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[carousel] decision failed"),
  );
  await answerCallback(cb.id, action === "approve" ? "Approved ✅" : "Rejected ❌");
  if (cb.message?.message_id) await editDecisionMarkup(chatId, cb.message.message_id, action === "approve" ? `✅ Approved by ${who}` : `❌ Rejected by ${who}`);
  return true;
}
