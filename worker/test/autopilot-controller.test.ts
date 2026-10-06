import { describe, it, expect } from "vitest";
import { formatAutopilotDigest, AutopilotHealthSummary } from "../src/pipeline/autopilot-controller";

function summary(overrides: Partial<AutopilotHealthSummary> = {}): AutopilotHealthSummary {
  return {
    emergencyStop: false,
    config: { autopilotSocialPosting: true, aiConfigured: true, whatsappConfigured: true, whatsappTemplatesMissing: [], resendConfigured: false },
    counts: { date: "2026-01-01", leadsToday: 3, totalLeads: 50, optedIn: 40, unsubscribed: 5, postsPublishedToday: 2, postsFailedToday: 0, conversationsToday: 7 },
    ...overrides,
  };
}

describe("formatAutopilotDigest (native port of n8n workflow 14's Build Daily Summary)", () => {
  it("includes the core counts", () => {
    const text = formatAutopilotDigest(summary());
    expect(text).toContain("+3 today");
    expect(text).toContain("50 total");
    expect(text).toContain("2 published today");
    expect(text).toContain("conversations today: 7");
  });

  it("surfaces an emergency-stop banner when stopped", () => {
    expect(formatAutopilotDigest(summary({ emergencyStop: true }))).toContain("EMERGENCY STOP IS ON");
    expect(formatAutopilotDigest(summary({ emergencyStop: false }))).not.toContain("EMERGENCY STOP IS ON");
  });

  it("lists missing WhatsApp templates only when there are any", () => {
    const withMissing = summary({ config: { ...summary().config, whatsappTemplatesMissing: ["tplWelcomeD1"] } });
    expect(formatAutopilotDigest(withMissing)).toContain("Missing WhatsApp templates: tplWelcomeD1");
    expect(formatAutopilotDigest(summary())).not.toContain("Missing WhatsApp templates");
  });
});
