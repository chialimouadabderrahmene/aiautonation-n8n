import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getStorage } from "../lib/storage";
import { isPracticeMode } from "../lib/practice";
import { getEmergencyStopState } from "../lib/outbound-guard";
import { checkRedis, checkStorage, checkWorker } from "../modules/system/health";
import { evaluateRequirements, takeSnapshot } from "../modules/workflows/readiness";
import { CAROUSEL_PIPELINE_REQUIREMENTS, VIDEO_PIPELINE_REQUIREMENTS } from "../modules/workflows/manifest";
import { ensureSamples } from "../modules/practice/samples";
import { getSetupSteps } from "../modules/practice/setup";
import { AUTOPILOTS, isAutopilotOn } from "../modules/autopilots/catalog";
import { summarizeSignups } from "../modules/signups/processor";

/**
 * One feed for the home screen: every piece of content on the line, what needs a human right
 * now, and whether the machinery is running, all in words a marketer would use. Videos,
 * carousels and text drafts have different tables underneath; the team should not have to care.
 */
export const homeRouter = Router();

export type Station = "making" | "review" | "scheduled" | "posted" | "stopped";

export interface Piece {
  kind: "video" | "carousel" | "post";
  id: string;
  title: string;
  station: Station;
  stage: string;
  progress: number;
  caption: string | null;
  practice: boolean;
  createdAt: string;
  preview: { type: "video" | "image"; url: string } | null;
  error: string | null;
  destinations: { target: string; status: string; url: string | null; scheduledFor: string | null; error: string | null }[];
}

const VIDEO_STAGES: Record<string, string> = {
  QUEUED: "Waiting its turn",
  SCRIPT_GENERATING: "Writing the script",
  STORYBOARD_READY: "Planning the scenes",
  VOICE_GENERATING: "Recording the voice",
  VISUAL_GENERATING: "Filming the scenes",
  ASSEMBLING: "Editing it together",
  QUALITY_CHECK: "Checking quality",
  READY: "Ready for you",
  FAILED: "Stopped",
  CANCELLED: "Cancelled",
};
const CAROUSEL_STAGES: Record<string, string> = {
  QUEUED: "Waiting its turn",
  SCRIPT_GENERATING: "Writing the slides",
  RENDERING: "Designing the slides",
  QUALITY_CHECK: "Checking quality",
  READY: "Ready for you",
  FAILED: "Stopped",
  CANCELLED: "Cancelled",
};

function stationFor(state: string, approval: string | null | undefined, pubs: { status: string }[]): Station {
  if (state === "FAILED" || state === "CANCELLED" || approval === "REJECTED") return "stopped";
  if (state !== "READY") return "making";
  if (approval !== "APPROVED") return "review";
  if (pubs.some((p) => p.status === "SCHEDULED" || p.status === "PENDING")) return "scheduled";
  return "posted";
}

async function sign(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const storage = getStorage();
  if (storage.driver === "none") return null;
  return storage.signedUrl(key, 3600).catch(() => null);
}

const destinationsOf = (pubs: { target: string; status: string; externalUrl: string | null; scheduledFor: Date | null; error: string | null }[]) =>
  pubs.map((p) => ({ target: p.target, status: p.status, url: p.externalUrl, scheduledFor: p.scheduledFor?.toISOString() ?? null, error: p.error }));

export async function buildPieces(take = 40): Promise<Piece[]> {
  const [videos, carousels, drafts] = await Promise.all([
    prisma.videoJob.findMany({ orderBy: { createdAt: "desc" }, take, include: { project: true, approval: true, publications: true } }),
    prisma.carouselJob.findMany({ orderBy: { createdAt: "desc" }, take, include: { project: true, approval: true, publications: true, slides: { where: { index: 0 }, take: 1 } } }),
    prisma.engineContentDraft.findMany({ orderBy: { createdAt: "desc" }, take }),
  ]);

  const videoPieces = await Promise.all(
    videos.map(async (j): Promise<Piece> => {
      const station = stationFor(j.state, j.approval?.status, j.publications);
      return {
        kind: "video", id: j.id, title: j.project.name, station,
        stage: j.approval?.status === "REJECTED" ? "Changes requested" : station === "posted" ? "Done" : station === "scheduled" ? "Going out" : VIDEO_STAGES[j.state] ?? j.state,
        progress: j.progress, caption: j.caption, practice: j.project.testMode, createdAt: j.createdAt.toISOString(),
        preview: j.finalVideoUrl ? { type: "video", url: (await sign(j.finalVideoUrl)) ?? "" } : null,
        error: j.state === "FAILED" ? j.error : j.approval?.rejectionReason ?? null,
        destinations: destinationsOf(j.publications),
      };
    }),
  );
  const carouselPieces = await Promise.all(
    carousels.map(async (j): Promise<Piece> => {
      const station = stationFor(j.state, j.approval?.status, j.publications);
      const cover = await sign(j.slides[0]?.imageUrl);
      return {
        kind: "carousel", id: j.id, title: j.project.name, station,
        stage: j.approval?.status === "REJECTED" ? "Changes requested" : station === "posted" ? "Done" : station === "scheduled" ? "Going out" : CAROUSEL_STAGES[j.state] ?? j.state,
        progress: j.progress, caption: j.caption, practice: j.project.testMode, createdAt: j.createdAt.toISOString(),
        preview: cover ? { type: "image", url: cover } : null,
        error: j.state === "FAILED" ? j.error : j.approval?.rejectionReason ?? null,
        destinations: destinationsOf(j.publications),
      };
    }),
  );
  const draftPieces = drafts.map((d): Piece => {
    const station: Station = d.status === "PUBLISHED" ? "posted" : d.status === "APPROVED" ? "scheduled" : d.status === "REJECTED" ? "stopped" : "review";
    return {
      kind: "post", id: d.id, title: d.body.replace("[Practice sample] ", "").slice(0, 70), station,
      stage: station === "posted" ? "Done" : station === "scheduled" ? "Next in the queue" : station === "stopped" ? "Rejected" : "Ready for you",
      progress: 100, caption: d.body, practice: d.source === "practice-sample" || d.body.startsWith("[Practice sample]"), createdAt: d.createdAt.toISOString(), preview: null,
      error: d.status === "REJECTED" ? d.reviewNote : null,
      destinations: d.platform ? [{ target: d.platform, status: d.status === "PUBLISHED" ? "PUBLISHED" : "PENDING", url: null, scheduledFor: null, error: null }] : [],
    };
  });
  return [...videoPieces, ...carouselPieces, ...draftPieces].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

homeRouter.get("/", async (_req, res) => {
  const practice = await isPracticeMode();
  if (practice) await ensureSamples();
  const since = new Date(Date.now() - WEEK_MS);

  const signupEvents = await prisma.attributionEvent.findMany({ where: { eventType: "registration", occurredAt: { gte: since } }, select: { metadata: true } });
  const signups = summarizeSignups(signupEvents, []);

  const [pieces, setup, stop, worker, queue, storage, autopilotRows, leadsWeek, leadsTotal, repliesWeek, videoPubs, carouselPubs, draftsPosted, cost, decided, published, firstReply, snap] = await Promise.all([
    buildPieces(),
    getSetupSteps(),
    getEmergencyStopState(),
    checkWorker(),
    checkRedis(),
    checkStorage(),
    prisma.engineWorkflow.findMany({ select: { key: true, enabled: true, triggerType: true } }),
    prisma.engineLead.count({ where: { createdAt: { gte: since } } }),
    prisma.engineLead.count(),
    prisma.engineWhatsAppConversation.count({ where: { replySent: { not: null }, createdAt: { gte: since } } }),
    prisma.publication.count({ where: { status: "PUBLISHED", publishedAt: { gte: since } } }),
    prisma.carouselPublication.count({ where: { status: "PUBLISHED", publishedAt: { gte: since } } }),
    prisma.engineContentDraft.count({ where: { status: "PUBLISHED", updatedAt: { gte: since } } }),
    prisma.providerUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costAmount: true } }),
    Promise.all([prisma.approval.count({ where: { status: { not: "PENDING" } } }), prisma.carouselApproval.count({ where: { status: { not: "PENDING" } } })]),
    Promise.all([prisma.publication.count({ where: { status: "PUBLISHED" } }), prisma.carouselPublication.count({ where: { status: "PUBLISHED" } })]),
    prisma.engineWhatsAppConversation.count({ where: { conversationStep: { not: "sample" }, replySent: { not: null } } }),
    takeSnapshot({ includeInfra: true }),
  ]);
  const [video, carousel] = await Promise.all([evaluateRequirements(VIDEO_PIPELINE_REQUIREMENTS, snap), evaluateRequirements(CAROUSEL_PIPELINE_REQUIREMENTS, snap)]);

  const autopilotsOn = AUTOPILOTS.filter((a) => isAutopilotOn(a, autopilotRows)).length;

  const line = { making: [] as Piece[], review: [] as Piece[], scheduled: [] as Piece[], posted: [] as Piece[], stopped: [] as Piece[] };
  for (const p of pieces) line[p.station].push(p);

  const problems: { title: string; detail: string; href: string }[] = [];
  if (worker.status !== "ONLINE") problems.push({ title: "The studio is offline", detail: "Nothing can be made until the worker is running. This is a technical fix, so send this to your developer.", href: "/back-office" });
  if (queue.status !== "ONLINE") problems.push({ title: "The queue is offline", detail: "Jobs cannot start until Redis is running. This is a technical fix, so send this to your developer.", href: "/back-office" });
  for (const p of line.stopped.filter((x) => x.kind !== "post" && x.error && x.stage === "Stopped").slice(0, 3)) {
    problems.push({ title: `"${p.title}" stopped`, detail: p.error ?? "It stopped part way through.", href: `/review/${p.kind}/${p.id}` });
  }

  const madeAny = pieces.some((p) => p.kind !== "post");
  const guide = [
    { id: "make", title: "Make your first reel", hint: "Type one idea and press Make it.", href: "/make", done: madeAny },
    { id: "review", title: "Approve it", hint: "Watch it, then approve or ask for changes.", href: "/review", done: decided[0] + decided[1] > 0 },
    { id: "post", title: "See it go out", hint: "Approved work moves to Posted on the line.", href: "/", done: published[0] + published[1] > 0 },
    { id: "autopilot", title: "Switch on an autopilot", hint: "Turn on Welcome every new lead.", href: "/autopilot", done: autopilotsOn > 0 },
    { id: "lead", title: "Watch a lead get answered", hint: "Send a pretend WhatsApp message.", href: "/people", done: firstReply > 0 },
    { id: "live", title: "Go live", hint: "Connect your accounts when you are ready.", href: "/setup", done: !practice },
  ];

  res.json({
    practice,
    stopped: stop.active,
    line,
    counts: { making: line.making.length, review: line.review.length, scheduled: line.scheduled.length, posted: line.posted.length, stopped: line.stopped.length },
    problems,
    week: { posted: videoPubs + carouselPubs + draftsPosted, made: pieces.filter((p) => new Date(p.createdAt).getTime() > Date.now() - WEEK_MS).length, leads: leadsWeek, leadsTotal, replies: repliesWeek, costUsd: Number(cost._sum.costAmount ?? 0), newAccounts: signups.users, newStores: signups.vendorStores },
    system: { worker: worker.status, queue: queue.status, storage: storage.status, ok: worker.status === "ONLINE" && queue.status === "ONLINE" },
    formats: {
      video: { ready: video.readiness === "READY", missing: video.detail.filter((d) => !d.ok).map((d) => d.label.replace(" or Groq or CodeCraft API", ", Groq or CodeCraft")) },
      carousel: { ready: carousel.readiness === "READY", missing: carousel.detail.filter((d) => !d.ok).map((d) => d.label.replace(" or Groq or CodeCraft API", ", Groq or CodeCraft")) },
    },
    setup,
    autopilotsOn,
    guide,
    generatedAt: new Date().toISOString(),
  });
});

/** The full feed, for the Review queue. */
homeRouter.get("/pieces", async (_req, res) => {
  res.json(await buildPieces(80));
});
