import { describe, expect, it } from "vitest";
import { WORKFLOW_MANIFEST, VIDEO_PIPELINE_REQUIREMENTS, VIDEO_APPROVAL_REQUIREMENTS } from "../src/modules/workflows/manifest";

describe("native workflow manifest", () => {
  it("contains unique native workflow definitions", () => {
    expect(WORKFLOW_MANIFEST.length).toBe(22);
    expect(new Set(WORKFLOW_MANIFEST.map((entry) => entry.key)).size).toBe(WORKFLOW_MANIFEST.length);
    for (const entry of WORKFLOW_MANIFEST) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.required.length).toBeGreaterThan(0);
    }
  });

  it("keeps media approval requirements explicit", () => {
    expect(VIDEO_PIPELINE_REQUIREMENTS).toContain("worker:ffmpeg");
    expect(VIDEO_PIPELINE_REQUIREMENTS).toContain("storage");
    expect(VIDEO_APPROVAL_REQUIREMENTS).toEqual(["telegram", "telegram:webhook"]);
  });
});
