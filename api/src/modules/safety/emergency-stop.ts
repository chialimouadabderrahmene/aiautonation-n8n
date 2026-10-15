import { prisma } from "../../lib/prisma";
import { getDeliveryQueue, type DeliveryJobPayload } from "../../lib/queue";

const CANCELLED_NOTE = "Cancelled by the emergency stop — resume outbound sending and re-approve to publish.";

/** Called when the stop is activated. Removes waiting and delayed outbound delivery jobs from
 * Redis and marks the matching not-yet-sent publications as SKIPPED. Jobs already executing are
 * left alone: they are re-checked at the start of their external call (see outbound-guard.ts),
 * so they cannot reach the provider once they pass that check. Anything that is not removed
 * here is still refused by the guard, so this is cleanup, not the safety boundary. */
export async function quarantineQueuedOutbound(): Promise<{ removedJobs: number; markedPublications: number; redisError: string | null }> {
  let removedJobs = 0;
  let redisError: string | null = null;
  try {
    const jobs = await getDeliveryQueue().getJobs(["waiting", "delayed", "paused"]);
    for (const job of jobs) {
      const data = job.data as DeliveryJobPayload;
      if (data.kind !== "publish" && data.kind !== "publish-carousel") continue;
      try {
        await job.remove();
        removedJobs += 1;
      } catch {
        // Locked by a worker that has just picked it up: the guard will refuse it there.
      }
    }
  } catch (err) {
    redisError = err instanceof Error ? err.message : String(err);
  }
  const [video, carousel] = await Promise.all([
    prisma.publication.updateMany({ where: { status: "PENDING" }, data: { status: "SKIPPED", error: CANCELLED_NOTE } }),
    prisma.carouselPublication.updateMany({ where: { status: "PENDING" }, data: { status: "SKIPPED", error: CANCELLED_NOTE } }),
  ]);
  return { removedJobs, markedPublications: video.count + carousel.count, redisError };
}
