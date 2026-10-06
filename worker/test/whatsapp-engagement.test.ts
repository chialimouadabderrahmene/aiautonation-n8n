import { describe, it, expect } from "vitest";
import { nextEngagementStep, EngagementContact } from "../src/pipeline/whatsapp-engagement";

const DAY = 86_400_000;

function contact(overrides: Partial<EngagementContact> = {}): EngagementContact {
  return {
    phone: "15551234567",
    role: "vendor",
    status: "COMPLETE",
    optIn: true,
    nurtureDay: 14, // vendor sequence's last day — "finished nurture"
    reengageStep: 0,
    lastMessageAt: null,
    lastNurtureAt: new Date(Date.now() - 10 * DAY),
    lastReengageAt: null,
    ...overrides,
  };
}

describe("nextEngagementStep (native port of n8n workflow 06's Select Inactive Leads)", () => {
  it("is null for a contact that hasn't finished its nurture sequence", () => {
    expect(nextEngagementStep(contact({ nurtureDay: 7 }))).toBeNull(); // vendor: last day is 14, not 7
  });

  it("is null when not optted in or not onboarded", () => {
    expect(nextEngagementStep(contact({ optIn: false }))).toBeNull();
    expect(nextEngagementStep(contact({ status: "SIGNUP_IN_PROGRESS" }))).toBeNull();
  });

  it("buyer's sequence finishes at day 5, not 14", () => {
    expect(nextEngagementStep(contact({ role: "buyer", nurtureDay: 5, lastNurtureAt: new Date(Date.now() - 10 * DAY) }))).toEqual({ stepIndex: 0, templateField: "tplReengage7" });
    expect(nextEngagementStep(contact({ role: "buyer", nurtureDay: 3, lastNurtureAt: new Date(Date.now() - 10 * DAY) }))).toBeNull();
  });

  it("requires 7 days of inactivity since the latest of lastMessageAt/lastNurtureAt/lastReengageAt", () => {
    expect(nextEngagementStep(contact({ lastNurtureAt: new Date(Date.now() - 2 * DAY) }))).toBeNull();
    expect(nextEngagementStep(contact({ lastNurtureAt: new Date(Date.now() - 8 * DAY) }))).toEqual({ stepIndex: 0, templateField: "tplReengage7" });
  });

  it("the most recent of the three timestamps wins, not just lastNurtureAt", () => {
    const old = new Date(Date.now() - 20 * DAY);
    const recent = new Date(Date.now() - 1 * DAY);
    expect(nextEngagementStep(contact({ lastNurtureAt: old, lastMessageAt: recent }))).toBeNull();
  });

  it("advances through steps 0, 1, 2 then stops", () => {
    expect(nextEngagementStep(contact({ reengageStep: 1 }))?.templateField).toBe("tplReengage14");
    expect(nextEngagementStep(contact({ reengageStep: 2 }))?.templateField).toBe("tplReengage21");
    expect(nextEngagementStep(contact({ reengageStep: 3 }))).toBeNull();
  });
});
