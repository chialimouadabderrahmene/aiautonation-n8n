import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTOMATION_SECRET_KEY = "a".repeat(64);
});

describe("credential encryption", () => {
  it("round-trips and never stores plaintext", async () => {
    const { encrypt, decrypt } = await import("../src/lib/crypto");
    const enc = encrypt("sk-live-secret-value-123");
    expect(enc.ciphertext).not.toContain("sk-live");
    expect(decrypt(enc)).toBe("sk-live-secret-value-123");
  });
  it("detects tampering (GCM auth tag)", async () => {
    const { encrypt, decrypt } = await import("../src/lib/crypto");
    const enc = encrypt("value");
    const tampered = { ...enc, ciphertext: Buffer.from("xxxxx").toString("base64") };
    expect(() => decrypt(tampered)).toThrow();
  });
  it("masks secrets", async () => {
    const { maskSecret } = await import("../src/lib/crypto");
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a••••••••mnop");
    expect(maskSecret("short")).toBe("••••••••");
  });
});
