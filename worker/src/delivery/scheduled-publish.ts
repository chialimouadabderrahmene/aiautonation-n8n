import { UnrecoverableError } from "bullmq";
import { prisma } from "../lib/prisma";
import { ProviderError, scrubSecrets } from "../lib/http";
import { isOutboundBlocked } from "../lib/outbound-guard";
import type { ScheduledPublishPayload } from "../lib/queue";
import { publishVideo } from "./publish";
import { publishCarousel } from "./publish-carousel";

/**
 * Publishes one scheduled row at its scheduled time. Everything that could have changed since the
 * schedule was set is checked again here, in this order, before any external call:
 *   1. The row still carries this scheduleVersion (not rescheduled, cancelled or already run).
 *   2. Approval is still APPROVED (a rejection or re-review after scheduling blocks publishing).
 *   3. The content is still READY.
 *   4. The row is claimed atomically (SCHEDULED -> PUBLISHING), so only one worker can publish it.
 *   5. publishVideo/publishCarousel run their own emergency-stop and target-configuration checks
 *      before the first external request.
 * A retryable provider failure puts the row back to SCHEDULED and lets BullMQ retry the same
 * version. Anything that is not retryable ends as FAILED and is never re-sent automatically.
 */

export type ScheduledPublishOutcome = "published" | "stale" | "approval_revoked" | "not_ready" | "already_claimed" | "blocked";

export interface ScheduledPublishDeps {
  attemptsMade: number;
  maxAttempts: number;
  audit: (action: string, entityId: string, metadata: Record<string, unknown>) => Promise<void>;
}

const REVOKED_NOTE = "Not published: the approval was changed after this was scheduled. Approve it again and reschedule.";
const NOT_READY_NOTE = "Not published: the content is no longer READY.";

export async function processScheduledPublish(payload: ScheduledPublishPayload, deps: ScheduledPublishDeps): Promise<ScheduledPublishOutcome> {
  return payload.model === "video" ? processVideo(payload, deps) : processCarousel(payload, deps);
}

async function processVideo(payload: ScheduledPublishPayload, deps: ScheduledPublishDeps): Promise<ScheduledPublishOutcome> {
  const row = await prisma.publication.findUnique({ where: { id: payload.publicationId }, include: { videoJob: { include: { approval: true } } } });
  if (!row || row.status !== "SCHEDULED" || row.scheduleVersion !== payload.scheduleVersion) return "stale";

  if (row.videoJob.approval?.status !== "APPROVED") {
    await prisma.publication.update({ where: { id: row.id }, data: { status: "CANCELLED", error: REVOKED_NOTE } });
    await deps.audit("video.schedule_blocked", row.videoJobId, { target: row.target, reason: "approval_not_approved" });
    return "approval_revoked";
  }
  if (row.videoJob.state !== "READY") {
    await prisma.publication.update({ where: { id: row.id }, data: { status: "CANCELLED", error: NOT_READY_NOTE } });
    await deps.audit("video.schedule_blocked", row.videoJobId, { target: row.target, reason: "not_ready", state: row.videoJob.state });
    return "not_ready";
  }

  const claim = await prisma.publication.updateMany({
    where: { id: row.id, status: "SCHEDULED", scheduleVersion: payload.scheduleVersion },
    data: { status: "PUBLISHING", attempts: { increment: 1 } },
  });
  if (claim.count === 0) return "already_claimed";

  try {
    const result = await publishVideo(row.videoJobId, row.target, row.connectedAccountId ?? undefined);
    await prisma.publication.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", externalId: result.externalId, externalUrl: result.externalUrl ?? null, error: null, publishedAt: new Date() },
    });
    await deps.audit("video.published", row.videoJobId, { target: row.target, scheduled: true, externalId: result.externalId });
    return "published";
  } catch (err) {
    return handleFailure(err, deps, async (status, error) => {
      await prisma.publication.update({ where: { id: row.id }, data: { status, error } });
      await deps.audit(status === "SKIPPED" ? "video.publish_blocked" : "video.publish_failed", row.videoJobId, { target: row.target, scheduled: true, error });
    }, "blocked");
  }
}

async function processCarousel(payload: ScheduledPublishPayload, deps: ScheduledPublishDeps): Promise<ScheduledPublishOutcome> {
  const row = await prisma.carouselPublication.findUnique({ where: { id: payload.publicationId }, include: { carouselJob: { include: { approval: true } } } });
  if (!row || row.status !== "SCHEDULED" || row.scheduleVersion !== payload.scheduleVersion) return "stale";

  if (row.carouselJob.approval?.status !== "APPROVED") {
    await prisma.carouselPublication.update({ where: { id: row.id }, data: { status: "CANCELLED", error: REVOKED_NOTE } });
    await deps.audit("carousel.schedule_blocked", row.carouselJobId, { target: row.target, reason: "approval_not_approved" });
    return "approval_revoked";
  }
  if (row.carouselJob.state !== "READY") {
    await prisma.carouselPublication.update({ where: { id: row.id }, data: { status: "CANCELLED", error: NOT_READY_NOTE } });
    await deps.audit("carousel.schedule_blocked", row.carouselJobId, { target: row.target, reason: "not_ready", state: row.carouselJob.state });
    return "not_ready";
  }

  const claim = await prisma.carouselPublication.updateMany({
    where: { id: row.id, status: "SCHEDULED", scheduleVersion: payload.scheduleVersion },
    data: { status: "PUBLISHING", attempts: { increment: 1 } },
  });
  if (claim.count === 0) return "already_claimed";

  try {
    const result = await publishCarousel(row.carouselJobId, row.target, row.connectedAccountId ?? undefined);
    await prisma.carouselPublication.update({
      where: { id: row.id },
      data: { status: "PUBLISHED", externalId: result.externalId, externalUrl: result.externalUrl ?? null, error: null, publishedAt: new Date() },
    });
    await deps.audit("carousel.published", row.carouselJobId, { target: row.target, scheduled: true, externalId: result.externalId });
    return "published";
  } catch (err) {
    return handleFailure(err, deps, async (status, error) => {
      await prisma.carouselPublication.update({ where: { id: row.id }, data: { status, error } });
      await deps.audit(status === "SKIPPED" ? "carousel.publish_blocked" : "carousel.publish_failed", row.carouselJobId, { target: row.target, scheduled: true, error });
    }, "blocked");
  }
}

/** Shared failure policy. Deliberate blocks are SKIPPED and never retried; retryable provider
 * errors go back to SCHEDULED for the same version; everything else is FAILED and not re-sent. */
async function handleFailure(
  err: unknown,
  deps: ScheduledPublishDeps,
  record: (status: "SCHEDULED" | "SKIPPED" | "FAILED", error: string) => Promise<void>,
  blockedOutcome: ScheduledPublishOutcome,
): Promise<ScheduledPublishOutcome> {
  if (isOutboundBlocked(err)) {
    await record("SKIPPED", err.message.slice(0, 800));
    return blockedOutcome;
  }
  const message = scrubSecrets(err instanceof Error ? err.message : String(err), []).slice(0, 800);
  const retryable = err instanceof ProviderError ? err.retryable : false;
  if (retryable && deps.attemptsMade + 1 < deps.maxAttempts) {
    await record("SCHEDULED", `Attempt ${deps.attemptsMade + 1}/${deps.maxAttempts} failed, retrying: ${message}`);
    throw err;
  }
  await record("FAILED", message);
  throw new UnrecoverableError(message);
}
