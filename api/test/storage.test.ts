import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTOMATION_SECRET_KEY = "b".repeat(64);
});

describe("local signed media links", () => {
  it("accept a valid signature and reject tampering/expiry", async () => {
    const { signLocalKey, verifyLocalSignature } = await import("../src/lib/storage");
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signLocalKey("jobs/a/final.mp4", exp);
    expect(verifyLocalSignature("jobs/a/final.mp4", exp, sig)).toBe(true);
    expect(verifyLocalSignature("jobs/b/final.mp4", exp, sig)).toBe(false);
    expect(verifyLocalSignature("jobs/a/final.mp4", exp + 1, sig)).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 5;
    expect(verifyLocalSignature("jobs/a/final.mp4", past, signLocalKey("jobs/a/final.mp4", past))).toBe(false);
  });
});
