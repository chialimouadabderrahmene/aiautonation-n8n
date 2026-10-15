import { describe, expect, it } from "vitest";
import { SETTINGS } from "../src/modules/settings/schema";

describe("client requirements configuration", () => {
  it("exposes unanswered intake fields with blank-safe defaults", () => {
    for (const key of ["brandVoice", "vendorAudienceProfile", "buyerAudienceProfile", "contentForbiddenTopics", "brandedHashtags", "contentFormats"]) {
      const def = SETTINGS.find((s) => s.key === key);
      expect(def, key).toBeTruthy();
      expect(def?.default).toBe("");
    }
  });

  it("does not assume a Pidgin policy", () => {
    expect(SETTINGS.find((s) => s.key === "pidginPolicy")?.default).toBe("unspecified");
  });
});
