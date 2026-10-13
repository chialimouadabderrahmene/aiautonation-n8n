import { describe, it, expect } from "vitest";
import { nextNurtureStep, NurtureContact } from "../src/pipeline/whatsapp-nurture";

const DAY = 86_400_000;
const HOUR = 3_600_000;

function contact(overrides: Partial<NurtureContact> = {}): NurtureContact {
  return {
    phone: "15551234567",
    role: "vendor",
    status: "COMPLETE",
    optIn: true,
    nurtureDay: 0,
    lastNurtureAt: null,
    optInAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("nextNurtureStep (native port of n8n workflow 19's Select Nurture Leads)", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("is null for a contact that hasn't opted in", () => {
    expect(nextNurtureStep(contact({ optIn: false }), now)).toBeNull();
  });

  it("is null for a contact not yet onboarded (status other than COMPLETE)", () => {
    expect(nextNurtureStep(contact({ status: "SIGNUP_IN_PROGRESS" }), now)).toBeNull();
  });

  it("is null when the role is neither vendor nor buyer", () => {
    expect(nextNurtureStep(contact({ role: null }), now)).toBeNull();
  });

  it("is null for an invalid phone number", () => {
    expect(nextNurtureStep(contact({ phone: "123" }), now)).toBeNull();
  });

  it("day 1 is not due before 1 day has passed since the anchor", () => {
    const anchored = new Date(now.getTime() - 12 * HOUR);
    expect(nextNurtureStep(contact({ createdAt: anchored }), now)).toBeNull();
  });

  it("day 1 is due once ~1 day has passed (within the 0.05-day tolerance)", () => {
    const anchored = new Date(now.getTime() - (1 * DAY - 0.01 * DAY));
    expect(nextNurtureStep(contact({ createdAt: anchored }), now)).toEqual({ day: 1, templateField: "tplNurtureVendorD1", linkKind: "vendor" });
  });

  it("uses optInAt over createdAt as the anchor when both are set", () => {
    const createdLongAgo = new Date(now.getTime() - 30 * DAY);
    const optedInRecently = new Date(now.getTime() - 0.5 * DAY);
    expect(nextNurtureStep(contact({ createdAt: createdLongAgo, optInAt: optedInRecently }), now)).toBeNull();
  });

  it("vendor sequence follows days 1, 2, 3, 7, 14 in order", () => {
    const anchored = new Date(now.getTime() - 20 * DAY);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 0 }), now)?.day).toBe(1);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 1 }), now)?.day).toBe(2);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 3 }), now)?.day).toBe(7);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 14 }), now)).toBeNull(); // sequence complete
  });

  it("buyer sequence follows days 1, 3, 5 with its own templates and the app link", () => {
    const anchored = new Date(now.getTime() - 20 * DAY);
    const step = nextNurtureStep(contact({ role: "buyer", createdAt: anchored, nurtureDay: 0 }), now);
    expect(step).toEqual({ day: 1, templateField: "tplNurtureBuyerD1", linkKind: "app" });
    expect(nextNurtureStep(contact({ role: "buyer", createdAt: anchored, nurtureDay: 1 }), now)?.day).toBe(3);
    expect(nextNurtureStep(contact({ role: "buyer", createdAt: anchored, nurtureDay: 5 }), now)).toBeNull();
  });

  it("enforces the 20-hour cooldown between sends", () => {
    const anchored = new Date(now.getTime() - 20 * DAY);
    const justSent = new Date(now.getTime() - 10 * HOUR);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 1, lastNurtureAt: justSent }), now)).toBeNull();
  });

  it("is due again once the cooldown has passed", () => {
    const anchored = new Date(now.getTime() - 20 * DAY);
    const longEnoughAgo = new Date(now.getTime() - 21 * HOUR);
    expect(nextNurtureStep(contact({ createdAt: anchored, nurtureDay: 1, lastNurtureAt: longEnoughAgo }), now)?.day).toBe(2);
  });
});
