import { prisma } from "../../lib/prisma";
import { enqueueScheduledPublish, removeScheduledPublishJob, type ScheduledModel } from "../../lib/queue";
import { getEmergencyStopState } from "../../lib/outbound-guard";
import { recordAudit } from "../audit/audit";

/**
 * Durable scheduling for approved video and carousel publishes.
 *
 * Source of truth is the Publication / CarouselPublication row (status SCHEDULED, scheduledFor,
 * scheduleVersion). The BullMQ delayed job is only a timer: it is keyed deterministically by
 * (row id, version), so re-adding it is idempotent, and a sweep re-creates any timer that was lost
 * (Redis flush, worker restart, failed enqueue). A rescheduled or cancelled row bumps its version,
 * so an older timer that still fires is a no-op.
 *
 * Scheduling itself never sends anything: approval, the emergency stop and the content state are
 * all checked again at the moment of publishing (worker/src/delivery/scheduled-publish.ts).
 */

/** Earliest allowed publish time from "now". Shorter leads race the sweep and the delayed job. */
export const MIN_LEAD_MS = 60_000;
/** A schedule this far in the past when the sweep finds it is missed, not published late. */
export const LATE_TOLERANCE_MS = 60 * 60_000;
/** How far ahead the sweep pre-enqueues timers, so the delayed job exists before it is due. */
export const SWEEP_LOOKAHEAD_MS = 2 * 60_000;

export class SchedulingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function parseScheduledFor(input: unknown, now = new Date()): Date {
  if (typeof input !== "string" || !input.trim()) throw new SchedulingError("scheduledFor is required (an ISO 8601 date-time with a timezone offset)", 400);
  const when = new Date(input);
  if (Number.isNaN(when.getTime())) throw new SchedulingError("scheduledFor is not a valid date-time", 400);
  if (when.getTime() - now.getTime() < MIN_LEAD_MS) throw new SchedulingError("scheduledFor must be at least one minute in the future", 400);
  return when;
}

async function assertNotStopped(): Promise<void> {
  const stop = await getEmergencyStopState();
  if (stop.active) throw new SchedulingError("The emergency stop is on — new outbound schedules are refused until an Owner resumes outbound sending", 409);
}

export interface ScheduleOutcome {
  scheduled: { target: string; publicationId: string; scheduledFor: string; scheduleVersion: number }[];
  refused: { target: string; reason: string }[];
}

/** Schedules every publish destination of a READY video. Approval is NOT required to schedule;
 * it is required at the moment of publishing, and re-checked then. */
export async function scheduleVideo(videoJobId: string, when: Date, timezone: string, actor: string): Promise<ScheduleOutcome> {
  await assertNotStopped();
  const job = await prisma.videoJob.findUnique({ where: { id: videoJobId }, include: { project: true } });
  if (!job) throw new SchedulingError("Video job not found", 404);
  if (job.state !== "READY") throw new SchedulingError(`Only a READY video can be scheduled (this one is ${job.state})`, 409);

  const outcome: ScheduleOutcome = { scheduled: [], refused: [] };
  const destinations: { where: { videoJobId_target: { videoJobId: string; target: string } } | { videoJobId_connectedAccountId: { videoJobId: string; connectedAccountId: string } }; target: string; connectedAccountId?: string }[] = [];
  for (const target of job.project.publishTargets) destinations.push({ where: { videoJobId_target: { videoJobId, target } }, target });
  if (job.project.publishAccountIds.length) {
    const accounts = await prisma.connectedAccount.findMany({ where: { id: { in: job.project.publishAccountIds } } });
    for (const a of accounts) destinations.push({ where: { videoJobId_connectedAccountId: { videoJobId, connectedAccountId: a.id } }, target: a.provider, connectedAccountId: a.id });
  }

  for (const d of destinations) {
    const existing = await prisma.publication.findUnique({ where: d.where });
    if (existing && (existing.status === "PUBLISHED" || existing.status === "PUBLISHING")) {
      outcome.refused.push({ target: d.target, reason: `already ${existing.status.toLowerCase()}` });
      continue;
    }
    const version = (existing?.scheduleVersion ?? 0) + 1;
    if (existing?.status === "SCHEDULED") await removeScheduledPublishJob("video", existing.id, existing.scheduleVersion);
    const row = await prisma.publication.upsert({
      where: d.where,
      update: { status: "SCHEDULED", scheduledFor: when, scheduleTimezone: timezone, scheduleVersion: version, error: null },
      create: { videoJobId, target: d.target, connectedAccountId: d.connectedAccountId ?? null, status: "SCHEDULED", scheduledFor: when, scheduleTimezone: timezone, scheduleVersion: version },
    });
    await enqueueScheduledPublish({ model: "video", publicationId: row.id, scheduleVersion: version, requestedBy: actor }, when.getTime() - Date.now());
    outcome.scheduled.push({ target: d.target, publicationId: row.id, scheduledFor: when.toISOString(), scheduleVersion: version });
  }
  if (outcome.scheduled.length) await recordAudit(actor, "video.scheduled", "VideoJob", videoJobId, { scheduledFor: when.toISOString(), timezone, targets: outcome.scheduled.map((s) => s.target) });
  return outcome;
}

export async function scheduleCarousel(carouselJobId: string, when: Date, timezone: string, actor: string): Promise<ScheduleOutcome> {
  await assertNotStopped();
  const job = await prisma.carouselJob.findUnique({ where: { id: carouselJobId }, include: { project: true } });
  if (!job) throw new SchedulingError("Carousel job not found", 404);
  if (job.state !== "READY") throw new SchedulingError(`Only a READY carousel can be scheduled (this one is ${job.state})`, 409);

  const outcome: ScheduleOutcome = { scheduled: [], refused: [] };
  const destinations: { where: { carouselJobId_target: { carouselJobId: string; target: string } } | { carouselJobId_connectedAccountId: { carouselJobId: string; connectedAccountId: string } }; target: string; connectedAccountId?: string }[] = [];
  for (const target of job.project.publishTargets) destinations.push({ where: { carouselJobId_target: { carouselJobId, target } }, target });
  if (job.project.publishAccountIds.length) {
    const accounts = await prisma.connectedAccount.findMany({ where: { id: { in: job.project.publishAccountIds } } });
    for (const a of accounts) destinations.push({ where: { carouselJobId_connectedAccountId: { carouselJobId, connectedAccountId: a.id } }, target: a.provider, connectedAccountId: a.id });
  }

  for (const d of destinations) {
    const existing = await prisma.carouselPublication.findUnique({ where: d.where });
    if (existing && (existing.status === "PUBLISHED" || existing.status === "PUBLISHING")) {
      outcome.refused.push({ target: d.target, reason: `already ${existing.status.toLowerCase()}` });
      continue;
    }
    const version = (existing?.scheduleVersion ?? 0) + 1;
    if (existing?.status === "SCHEDULED") await removeScheduledPublishJob("carousel", existing.id, existing.scheduleVersion);
    const row = await prisma.carouselPublication.upsert({
      where: d.where,
      update: { status: "SCHEDULED", scheduledFor: when, scheduleTimezone: timezone, scheduleVersion: version, error: null },
      create: { carouselJobId, target: d.target, connectedAccountId: d.connectedAccountId ?? null, status: "SCHEDULED", scheduledFor: when, scheduleTimezone: timezone, scheduleVersion: version },
    });
    await enqueueScheduledPublish({ model: "carousel", publicationId: row.id, scheduleVersion: version, requestedBy: actor }, when.getTime() - Date.now());
    outcome.scheduled.push({ target: d.target, publicationId: row.id, scheduledFor: when.toISOString(), scheduleVersion: version });
  }
  if (outcome.scheduled.length) await recordAudit(actor, "carousel.scheduled", "CarouselJob", carouselJobId, { scheduledFor: when.toISOString(), timezone, targets: outcome.scheduled.map((s) => s.target) });
  return outcome;
}

/** Cancels every not-yet-published schedule of one content item. Bumps each version so any
 * timer that is still alive can never publish. Returns how many rows were cancelled. */
export async function cancelSchedules(model: ScheduledModel, contentId: string, reason: string, actor: string): Promise<number> {
  const rows =
    model === "video"
      ? await prisma.publication.findMany({ where: { videoJobId: contentId, status: "SCHEDULED" } })
      : await prisma.carouselPublication.findMany({ where: { carouselJobId: contentId, status: "SCHEDULED" } });
  for (const row of rows) {
    await removeScheduledPublishJob(model, row.id, row.scheduleVersion);
    const data = { status: "CANCELLED" as const, error: reason.slice(0, 500), scheduleVersion: row.scheduleVersion + 1 };
    if (model === "video") await prisma.publication.update({ where: { id: row.id }, data });
    else await prisma.carouselPublication.update({ where: { id: row.id }, data });
  }
  if (rows.length) await recordAudit(actor, model === "video" ? "video.schedule_cancelled" : "carousel.schedule_cancelled", model === "video" ? "VideoJob" : "CarouselJob", contentId, { reason, count: rows.length });
  return rows.length;
}

/** Re-creates timers for schedules that are due soon, and marks schedules that are long overdue
 * as missed. Safe to run repeatedly and from several processes: timers are deterministic by id
 * and version, and the worker claims each row atomically before publishing. */
export async function sweepScheduledPublications(now = new Date()): Promise<{ enqueued: number; missed: number; stopped: boolean }> {
  const stop = await getEmergencyStopState();
  const horizon = new Date(now.getTime() + SWEEP_LOOKAHEAD_MS);
  const overdueBefore = new Date(now.getTime() - LATE_TOLERANCE_MS);

  const missed = await Promise.all([
    prisma.publication.updateMany({ where: { status: "SCHEDULED", scheduledFor: { lt: overdueBefore } }, data: { status: "SKIPPED", error: "Missed its scheduled time by more than an hour — reschedule it to publish." } }),
    prisma.carouselPublication.updateMany({ where: { status: "SCHEDULED", scheduledFor: { lt: overdueBefore } }, data: { status: "SKIPPED", error: "Missed its scheduled time by more than an hour — reschedule it to publish." } }),
  ]);
  const missedCount = missed[0].count + missed[1].count;
  if (stop.active) return { enqueued: 0, missed: missedCount, stopped: true };

  const due = [
    ...(await prisma.publication.findMany({ where: { status: "SCHEDULED", scheduledFor: { gte: overdueBefore, lte: horizon } } })).map((r) => ({ model: "video" as const, ...r })),
    ...(await prisma.carouselPublication.findMany({ where: { status: "SCHEDULED", scheduledFor: { gte: overdueBefore, lte: horizon } } })).map((r) => ({ model: "carousel" as const, ...r })),
  ];
  let enqueued = 0;
  for (const row of due) {
    await enqueueScheduledPublish({ model: row.model, publicationId: row.id, scheduleVersion: row.scheduleVersion, requestedBy: "scheduler" }, Math.max(0, (row.scheduledFor?.getTime() ?? now.getTime()) - now.getTime()));
    enqueued += 1;
  }
  return { enqueued, missed: missedCount, stopped: false };
}
