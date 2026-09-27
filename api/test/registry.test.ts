import { describe, it, expect } from "vitest";
import { PROVIDERS, getProvider, validateProviderInput, publicProviderSchema } from "../src/modules/providers/registry";

describe("provider registry", () => {
  it("covers every required provider", () => {
    const keys = PROVIDERS.map((p) => p.key);
    for (const k of ["openai", "groq", "n8n", "telegram", "whatsapp", "resend", "buffer", "x", "meta", "linkedin", "apify", "runway", "elevenlabs", "google-sheets"]) {
      expect(keys).toContain(k);
    }
  });
  it("uses OAuth (not pasted tokens) for X, Meta and LinkedIn", () => {
    for (const k of ["x", "meta", "linkedin"]) {
      const p = getProvider(k)!;
      expect(p.authType).toBe("OAUTH");
      expect(p.oauth).toBeDefined();
      expect(p.fields.some((f) => /token/i.test(f.name))).toBe(false);
    }
  });
  it("public schema contains no functions", () => {
    const s = JSON.stringify(PROVIDERS.map(publicProviderSchema));
    expect(s).not.toMatch(/testConnection|exchangeCode/);
  });
  it("validates required fields, patterns and unknown fields", () => {
    const openai = getProvider("openai")!;
    expect(validateProviderInput(openai, {}, {}, new Set()).map((e) => e.field)).toContain("apiKey");
    expect(validateProviderInput(openai, { apiKey: "nope" }, {}, new Set())[0]!.message).toMatch(/sk-/);
    expect(validateProviderInput(openai, { apiKey: "sk-" + "a".repeat(30) }, {}, new Set())).toEqual([]);
    expect(validateProviderInput(openai, {}, {}, new Set(["apiKey"]))).toEqual([]); // keep stored
    expect(validateProviderInput(openai, { evil: "x" }, {}, new Set(["apiKey"]))[0]!.field).toBe("evil");
    const tg = getProvider("telegram")!;
    expect(validateProviderInput(tg, { botToken: "123456789:" + "A".repeat(35) }, { approvalChatId: "-100123" }, new Set())).toEqual([]);
    expect(validateProviderInput(tg, { botToken: "123456789:" + "A".repeat(35) }, { approvalChatId: "team" }, new Set()).length).toBe(1);
  });
  it("rejects a JSON blob that is not a service account key", () => {
    const gs = getProvider("google-sheets")!;
    const errs = validateProviderInput(gs, { serviceAccountJson: '{"hello":1}' }, { spreadsheetId: "1".repeat(40) }, new Set());
    expect(errs.map((e) => e.field)).toContain("serviceAccountJson");
  });
});
