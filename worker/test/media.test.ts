import { describe, it, expect } from "vitest";
import { runwayParams } from "../src/pipeline/video";
import { buildSrt, chunkCaption, outputSize } from "../src/pipeline/assemble";

describe("Runway parameter mapping (per @runwayml/sdk constraints)", () => {
  it("gen4.5: 720:1280 / 1280:720, integer 2-10 s", () => {
    expect(runwayParams("gen4.5", "9:16", 6)).toEqual({ ratio: "720:1280", duration: 6 });
    expect(runwayParams("gen4.5", "16:9", 12)).toEqual({ ratio: "1280:720", duration: 10 });
    expect(runwayParams("gen4.5", "9:16", 1.2)).toEqual({ ratio: "720:1280", duration: 2 });
  });
  it("veo3.1: 1080:1920 and duration snapped to 4/6/8", () => {
    expect(runwayParams("veo3.1", "9:16", 5)).toEqual({ ratio: "1080:1920", duration: 6 }); // ties round up (never cut narration)
    expect(runwayParams("veo3.1", "9:16", 4.4)).toEqual({ ratio: "1080:1920", duration: 4 });
    expect(runwayParams("veo3.1_fast", "16:9", 7.4)).toEqual({ ratio: "1920:1080", duration: 8 });
  });
});

describe("subtitles", () => {
  it("chunks captions into short single lines", () => {
    const chunks = chunkCaption("Order fresh African ingredients from trusted vendors and get them delivered to your door");
    expect(chunks.every((c) => c.split(" ").length <= 5 && c.length <= 30)).toBe(true);
    expect(chunks.join(" ")).toBe("Order fresh African ingredients from trusted vendors and get them delivered to your door");
  });
  it("times cues inside each scene's narration window", () => {
    const srt = buildSrt([
      { subtitleText: "First scene words here", startSec: 0, speakSec: 3 },
      { subtitleText: "Second scene", startSec: 5, speakSec: 2 },
    ]);
    expect(srt).toContain("00:00:00,050 -->");
    expect(srt).toContain("00:00:05,050 -->");
    expect(srt.split("\n\n").length).toBe(2);
  });
  it("output sizes", () => {
    expect(outputSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(outputSize("16:9")).toEqual({ width: 1920, height: 1080 });
  });
});
