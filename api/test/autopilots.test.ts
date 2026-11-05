import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AUTOPILOTS, findAutopilot, isAutopilotOn } from "../src/modules/autopilots/catalog";

const seedSource = fs.readFileSync(path.resolve(__dirname, "../src/modules/engine/seed/ported-workflows.ts"), "utf8");
const seedKeys = [...seedSource.matchAll(/^ {4}key: "([a-z-]+)",$/gm)].map((m) => m[1]!);

describe("autopilot catalog", () => {
  it("every autopilot only names workflows that really exist", () => {
    for (const a of AUTOPILOTS) for (const key of a.workflows) expect(seedKeys, `${a.id} names ${key}`).toContain(key);
  });

  it("every workflow belongs to exactly one autopilot, so nothing is unreachable from the switches", () => {
    const owned = AUTOPILOTS.flatMap((a) => a.workflows);
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual([...seedKeys].sort());
  });

  it("the Try it now workflow is part of its own autopilot", () => {
    for (const a of AUTOPILOTS) expect(a.workflows).toContain(a.primary);
  });

  it("is on when scheduled work is on, whatever its webhooks are doing", () => {
    const welcome = findAutopilot("welcome-leads")!;
    const rows = (enabled: boolean) => [
      { key: "lead-capture-webhook", enabled: true, triggerType: "WEBHOOK" },
      { key: "whatsapp-lead-funnel", enabled, triggerType: "EVENT" },
      { key: "whatsapp-welcome-sequence", enabled, triggerType: "CRON" },
    ];
    expect(isAutopilotOn(welcome, rows(true))).toBe(true);
    expect(isAutopilotOn(welcome, rows(false))).toBe(false);
  });

  it("a job made only of webhooks is on only when all of them are", () => {
    const grow = findAutopilot("grow-list")!;
    const rows = (referral: boolean) => [
      { key: "waitlist-management", enabled: true, triggerType: "WEBHOOK" },
      { key: "referral-campaign", enabled: referral, triggerType: "WEBHOOK" },
      { key: "feedback-collection", enabled: true, triggerType: "WEBHOOK" },
    ];
    expect(isAutopilotOn(grow, rows(true))).toBe(true);
    expect(isAutopilotOn(grow, rows(false))).toBe(false);
  });
});
