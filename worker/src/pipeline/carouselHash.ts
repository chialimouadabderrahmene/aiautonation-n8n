import crypto from "node:crypto";

export type CarouselHashInput = { project: { topic: string; prompt: string; cta: string | null }; slides: Array<{ index: number; headline: string; body: string; imageKey?: string | null }> };

/** Stable approval fingerprint: changing the brief or any slide invalidates approval. */
export function carouselContentHash(input: CarouselHashInput): string {
  return crypto.createHash("sha256").update(JSON.stringify({ project: input.project, slides: input.slides.map(({ index, headline, body, imageKey }) => ({ index, headline, body, imageKey })) })).digest("hex");
}
