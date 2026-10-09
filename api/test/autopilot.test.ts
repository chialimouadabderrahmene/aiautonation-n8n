import { describe, it, expect } from "vitest";
import { evaluateAutopilot } from "../src/modules/automation/autopilot";

const ON = { autopilotStop: false, autopilotSocialPosting: true, twitterPostingEnabled: true };

describe("evaluateAutopilot (native port of n8n workflow 10's autopilot gate)", () => {
  it("allows a connected platform when autopilot is fully on", () => {
    expect(evaluateAutopilot(ON, "instagram")).toEqual({ allowed: true });
  });

  it("emergency stop blocks every platform, even with social posting on", () => {
    expect(evaluateAutopilot({ ...ON, autopilotStop: true }, "instagram").allowed).toBe(false);
    expect(evaluateAutopilot({ ...ON, autopilotStop: true }, "x").allowed).toBe(false);
  });

  it("blocks every platform when social posting is off, stop or not", () => {
    const off = { ...ON, autopilotSocialPosting: false };
    expect(evaluateAutopilot(off, "instagram").allowed).toBe(false);
    expect(evaluateAutopilot(off, "facebook").allowed).toBe(false);
  });

  it("X needs its own extra toggle on top of the overall opt-in", () => {
    expect(evaluateAutopilot({ ...ON, twitterPostingEnabled: false }, "x").allowed).toBe(false);
    expect(evaluateAutopilot({ ...ON, twitterPostingEnabled: false }, "instagram").allowed).toBe(true);
  });

  it("reason is set only when blocked", () => {
    expect(evaluateAutopilot(ON, "linkedin").reason).toBeUndefined();
    expect(evaluateAutopilot({ ...ON, autopilotStop: true }, "linkedin").reason).toMatch(/stop/i);
  });
});
