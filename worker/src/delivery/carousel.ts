import { prisma } from "../lib/prisma";
import { ProviderError } from "../lib/http";

export async function publishCarousel(carouselJobId: string, target: string): Promise<{ externalId: string; externalUrl?: string }> {
  const job = await prisma.carouselJob.findUnique({ where: { id: carouselJobId }, include: { approval: true, assets: true } });
  if (!job || job.state !== "READY") throw new ProviderError("Carousel is not READY", null, false);
  if (job.approval?.status !== "APPROVED") throw new ProviderError("Carousel is not approved", null, false);
  if (!job.assets.length) throw new ProviderError("Carousel has no rendered assets", null, false);
  // This deterministic adapter is intentionally limited to the simulated
  // provider used by local E2E. A real Meta/LinkedIn/TikTok carousel contract
  // must be selected and configured before live publishing is enabled.
  if (process.env.CAROUSEL_PUBLISH_TEST_MODE === "true") return { externalId: `mock-carousel-${carouselJobId}-${target}`, externalUrl: `https://example.invalid/${target}/${carouselJobId}` };
  throw new ProviderError(`Carousel publishing contract for ${target} is not configured`, null, false);
}
