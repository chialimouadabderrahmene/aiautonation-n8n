import { describe, expect, it } from "vitest";
import { carouselContentHash } from "../src/pipeline/carouselHash";

describe("carousel approval fingerprint", () => {
  const input = { project: { topic: "Vendor story", prompt: "Use approved facts", cta: "Join" }, slides: [{ index: 0, headline: "Vendor story", body: "Fact", imageKey: "a.svg" }] };
  it("is stable for identical content", () => expect(carouselContentHash(input)).toBe(carouselContentHash(structuredClone(input))));
  it("changes when approved content changes", () => expect(carouselContentHash(input)).not.toBe(carouselContentHash({ ...input, slides: [{ ...input.slides[0], body: "Changed" }] })));
});
