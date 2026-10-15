import { Job, UnrecoverableError } from "bullmq";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getStorage } from "../lib/storage";
import { emergencyStopEnabled } from "../lib/safety";
import { CarouselGenerationJobPayload } from "../lib/queue";
import { audit } from "./orchestrator";
import { carouselContentHash } from "./carouselHash";

function settingText(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function escapeXml(value: string): string { return value.replace(/[<>&'\"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[c] ?? c); }
function renderSlide(brand: string, headline: string, body: string, index: number, total: number): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#fffaf2"/><rect width="1080" height="30" fill="#b45309"/><text x="80" y="130" font-family="Arial" font-size="42" font-weight="700" fill="#78350f">${escapeXml(brand)}</text><text x="80" y="360" font-family="Arial" font-size="66" font-weight="700" fill="#111827">${escapeXml(headline)}</text><foreignObject x="80" y="470" width="900" height="500"><div xmlns="http://www.w3.org/1999/xhtml" style="font:36px Arial;color:#374151;line-height:1.35">${escapeXml(body)}</div></foreignObject><text x="80" y="1240" font-family="Arial" font-size="28" fill="#92400e">${index + 1} / ${total}</text></svg>`;
  return Buffer.from(svg);
}

export async function processCarouselJob(bullJob: Job<CarouselGenerationJobPayload>): Promise<void> {
  const { carouselJobId } = bullJob.data;
  if (await emergencyStopEnabled()) { await audit("carousel.job_blocked_emergency_stop", carouselJobId); return; }
  const job = await prisma.carouselJob.findUnique({ where: { id: carouselJobId }, include: { project: true } });
  if (!job || job.state === "CANCELLED" || job.state === "READY") return;
  const settings = await prisma.setting.findMany({ where: { key: { in: ["marketplaceTruth", "contentForbiddenTopics"] } } });
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const truth = settingText(values.marketplaceTruth);
  if (!truth) throw new UnrecoverableError("Approved marketplace facts are required before carousel generation");
  const forbidden = settingText(values.contentForbiddenTopics).split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (forbidden.some((word) => `${job.project.topic} ${job.project.prompt}`.toLowerCase().includes(word))) throw new UnrecoverableError("Carousel brief contains a forbidden topic");
  await prisma.carouselJob.update({ where: { id: carouselJobId }, data: { state: "GENERATING", error: null } });
  const slides = Array.from({ length: job.project.slideCount }, (_, index) => ({ index, headline: index === 0 ? job.project.topic : `${job.project.brand}: ${index + 1}`, body: index === job.project.slideCount - 1 ? (job.project.cta ?? truth) : `${job.project.prompt}\n\nApproved facts: ${truth}` }));
  await prisma.carouselJob.update({ where: { id: carouselJobId }, data: { state: "RENDERING" } });
  const storage = getStorage();
  await prisma.carouselSlide.deleteMany({ where: { jobId: carouselJobId } });
  await prisma.carouselAsset.deleteMany({ where: { jobId: carouselJobId } });
  const assets: Prisma.CarouselAssetCreateManyInput[] = [];
  for (const slide of slides) {
    const key = `carousels/${carouselJobId}/slide-${slide.index}.svg`;
    const rendered = renderSlide(job.project.brand, slide.headline, slide.body, slide.index, slides.length);
    await storage.putBuffer(key, rendered, "image/svg+xml");
    await prisma.carouselSlide.create({ data: { jobId: carouselJobId, index: slide.index, headline: slide.headline, body: slide.body, imageKey: key, status: "READY" } });
    assets.push({ jobId: carouselJobId, type: "SLIDE", index: slide.index, url: key, mimeType: "image/svg+xml", sizeBytes: rendered.length, metadata: { truthUsed: true } as Prisma.InputJsonValue });
  }
  await prisma.carouselAsset.createMany({ data: assets });
  const contentHash = carouselContentHash({ project: { topic: job.project.topic, prompt: job.project.prompt, cta: job.project.cta }, slides });
  await prisma.carouselJob.update({ where: { id: carouselJobId }, data: { state: "VALIDATING" } });
  if (slides.length < 2 || slides.some((s) => !s.headline.trim() || !s.body.trim())) throw new UnrecoverableError("Carousel validation failed");
  await prisma.carouselJob.update({ where: { id: carouselJobId }, data: { state: "READY", completedAt: new Date() } });
  await prisma.carouselApproval.upsert({ where: { carouselJobId }, update: { status: "PENDING", contentHash, decidedAt: null, decidedBy: null, rejectionReason: null, note: "Ready for human approval" }, create: { carouselJobId, contentHash, note: "Ready for human approval" } });
  await audit("carousel.job_ready", carouselJobId, { slides: slides.length, contentHash });
}
