import { describe, it, expect } from "vitest";
import { scrubSecrets, describeHttpFailure, withRetry, ProviderError } from "../src/lib/http";

describe("secret scrubbing", () => {
  it("removes known values and common token shapes", () => {
    const text = "failed https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe Bearer abcdefghijklmnopqrstu sk-proj-ABCDEFGHIJKLMNOPQRST access_token=EAAB123";
    const out = scrubSecrets(text, ["mysecretvalue"]);
    expect(out).not.toMatch(/AAHdqTcv|abcdefghijklmnopqrstu|ABCDEFGHIJKLMNOPQRST|EAAB123/);
    expect(scrubSecrets("x mysecretvalue y", ["mysecretvalue"])).toBe("x [REDACTED] y");
  });
});

describe("provider error mapping", () => {
  it("never retries auth failures, retries rate limits and 5xx", () => {
    expect(describeHttpFailure("X", 401).retryable).toBe(false);
    expect(describeHttpFailure("X", 403).retryable).toBe(false);
    expect(describeHttpFailure("X", 429).retryable).toBe(true);
    expect(describeHttpFailure("X", 503).retryable).toBe(true);
  });
  it("withRetry stops after the configured attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ProviderError("boom", 503, true);
      }, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("boom");
    expect(calls).toBe(3);
  });
  it("withRetry does not retry non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ProviderError("bad key", 401, false);
      }, { retries: 5, baseDelayMs: 1 }),
    ).rejects.toThrow("bad key");
    expect(calls).toBe(1);
  });
});
