import { describe, it, expect } from "vitest";
import { practiceProvider } from "../src/pipeline/practice";
import { scriptSchema } from "../src/pipeline/script";

const ask = async (system: string, user: string) => JSON.parse((await practiceProvider.chatJSON({ system, user })).raw);

describe("practice provider", () => {
  it("answers a script prompt with a script the real pipeline accepts, at the requested length", async () => {
    const script = await ask('Return {"hook":"...","scenes":[]} Produce exactly 4 scenes', "Brand: Eki\nTopic: Why egusi is hard to find");
    expect(scriptSchema.safeParse(script).success).toBe(true);
    expect(script.scenes).toHaveLength(4);
    expect(script.hook).toContain("Why egusi is hard to find");
  });

  it("answers a carousel prompt with the requested number of slides", async () => {
    const carousel = await ask('Return {"slides":[]} Produce exactly 5 slides', "Topic: Pantry staples");
    expect(carousel.slides).toHaveLength(5);
    expect(carousel.slides[0].headline).toBe("Pantry staples");
  });

  it("marks its captions as samples, so practice copy can never pass as real", async () => {
    const script = await ask('{"scenes":[]} exactly 3 scenes', "Topic: x");
    expect(script.caption).toContain("[Practice sample]");
  });

  it("passes the brand critic without calling anything", async () => {
    expect(await ask("Return onBrand and a score", "content")).toMatchObject({ onBrand: true, violations: [] });
  });
});
