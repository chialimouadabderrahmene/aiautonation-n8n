import { describe, it, expect } from "vitest";
import { nextWelcomeStep, WelcomeContact } from "../src/pipeline/whatsapp-welcome";

const HOUR = 3_600_000;

function contact(overrides: Partial<WelcomeContact> = {}): WelcomeContact {
  return { phone: "15551234567", status: "NEW", optIn: true, welcomeDay: 0, lastWelcomeAt: null, ...overrides };
}

describe("nextWelcomeStep (native port of n8n workflow 05's Select Welcome Leads)", () => {
  it("is null for a contact that hasn't opted in", () => {
    expect(nextWelcomeStep(contact({ optIn: false }))).toBeNull();
  });

  it("is null once status has moved past NEW (e.g. a role was chosen)", () => {
    expect(nextWelcomeStep(contact({ status: "AWAITING_ROLE" }))).toBeNull();
  });

  it("is null for an invalid phone", () => {
    expect(nextWelcomeStep(contact({ phone: "123" }))).toBeNull();
  });

  it("day 1 fires immediately for a fresh opted-in NEW contact, no cooldown", () => {
    expect(nextWelcomeStep(contact())).toEqual({ day: 1, templateField: "tplWelcomeD1" });
  });

  it("advances day by day up to 3, then stops", () => {
    expect(nextWelcomeStep(contact({ welcomeDay: 1, lastWelcomeAt: new Date(Date.now() - 21 * HOUR) }))?.day).toBe(2);
    expect(nextWelcomeStep(contact({ welcomeDay: 2, lastWelcomeAt: new Date(Date.now() - 21 * HOUR) }))?.day).toBe(3);
    expect(nextWelcomeStep(contact({ welcomeDay: 3, lastWelcomeAt: new Date(Date.now() - 21 * HOUR) }))).toBeNull();
  });

  it("enforces a 20h cooldown after day 1 but not before it", () => {
    const justSent = new Date(Date.now() - 5 * HOUR);
    expect(nextWelcomeStep(contact({ welcomeDay: 1, lastWelcomeAt: justSent }))).toBeNull();
    expect(nextWelcomeStep(contact({ welcomeDay: 0, lastWelcomeAt: justSent }))).toEqual({ day: 1, templateField: "tplWelcomeD1" });
  });
});
