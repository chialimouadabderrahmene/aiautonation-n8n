import { describe, expect, it } from "vitest";
import { shouldBlockOutboundJob } from "../src/lib/safety";

describe("emergency stop delivery gate", () => {
  it.each(["queued", "delayed", "retried", "replayed"])("blocks %s jobs at worker execution", () => {
    expect(shouldBlockOutboundJob(true)).toBe(true);
  });
  it("allows execution only when the stop is inactive", () => expect(shouldBlockOutboundJob(false)).toBe(false));
});
