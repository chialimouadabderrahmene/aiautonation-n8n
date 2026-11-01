import { describe, expect, it } from "vitest";
import { executionTitle, triggerLabel } from "../src/lib/signupDisplay";

const base = { workflowConfig: null, trigger: null, mode: null, relatedEntityType: null, relatedEntityId: null };

describe("signup execution display", () => {
  it("titles account signups", () => expect(executionTitle({ ...base, trigger: "eki_signup", mode: "user_registered" })).toBe("Eki signup · new account"));
  it("titles vendor store signups", () => expect(executionTitle({ ...base, trigger: "eki_signup", mode: "vendor_store_created" })).toBe("Eki signup · vendor store"));
  it("keeps workflow and video titles", () => {
    expect(executionTitle({ ...base, workflowConfig: { key: "k", name: "Daily post" } })).toBe("Daily post");
    expect(executionTitle({ ...base, relatedEntityType: "VideoJob", relatedEntityId: "v1" })).toBe("Video job");
  });
  it("labels the signup trigger", () => {
    expect(triggerLabel("eki_signup")).toBe("Eki marketplace signup");
    expect(triggerLabel(null)).toBe("—");
  });
});
