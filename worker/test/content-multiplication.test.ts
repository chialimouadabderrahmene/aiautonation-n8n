import { describe, it, expect } from "vitest";
import { buildContentVariantRows } from "../src/pipeline/content-multiplication";

describe("buildContentVariantRows (native port of n8n workflow 18's Build Queue Rows)", () => {
  it("emits one row per non-empty format", () => {
    const rows = buildContentVariantRows("idea", { reel_script: "a script", fb_post: "a post" });
    expect(rows).toEqual([
      { idea: "idea", format: "reel_script", content: "a script" },
      { idea: "idea", format: "fb_post", content: "a post" },
    ]);
  });

  it("numbers array-valued formats", () => {
    const rows = buildContentVariantRows("idea", { carousel: ["slide one", "slide two"] });
    expect(rows).toEqual([{ idea: "idea", format: "carousel", content: "1. slide one\n2. slide two" }]);
  });

  it("flattens hook/caption variations into their own numbered formats", () => {
    const rows = buildContentVariantRows("idea", { hook_variations: ["hook a", "hook b"], caption_variations: ["cap a"] });
    expect(rows).toEqual([
      { idea: "idea", format: "hook_variation_1", content: "hook a" },
      { idea: "idea", format: "hook_variation_2", content: "hook b" },
      { idea: "idea", format: "caption_variation_1", content: "cap a" },
    ]);
  });

  it("skips empty/missing formats entirely", () => {
    expect(buildContentVariantRows("idea", {})).toEqual([]);
    expect(buildContentVariantRows("idea", { fb_post: "" })).toEqual([]);
  });
});
