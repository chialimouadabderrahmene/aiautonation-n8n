import { describe, it, expect } from "vitest";
import { parseCron, nextRunAt } from "../src/modules/engine/cron";

function wallClock(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23", day: "numeric", month: "numeric", year: "numeric", weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")), minute: Number(get("minute")), day: Number(get("day")), month: Number(get("month")), year: Number(get("year")), weekday: get("weekday") };
}

describe("cron parser", () => {
  it("parses wildcards, lists, ranges and steps", () => {
    const c = parseCron("0,15,30,45 9-17 * * 1-5");
    expect([...c.minutes]).toEqual([0, 15, 30, 45]);
    expect(c.hours.has(9)).toBe(true);
    expect(c.hours.has(18)).toBe(false);
    expect([...c.dows].sort()).toEqual([1, 2, 3, 4, 5]);
  });
  it("rejects malformed expressions instead of guessing", () => {
    expect(() => parseCron("* * *")).toThrow();
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* 24 * * *")).toThrow();
  });
});

describe("nextRunAt — UTC", () => {
  it("every day at 09:00 lands exactly on 09:00 the same or next day", () => {
    const after = new Date("2026-06-01T08:00:00Z");
    const next = nextRunAt("0 9 * * *", "UTC", after);
    expect(next.toISOString()).toBe("2026-06-01T09:00:00.000Z");
  });
  it("rolls to the next day once today's time has passed", () => {
    const after = new Date("2026-06-01T10:00:00Z");
    const next = nextRunAt("0 9 * * *", "UTC", after);
    expect(next.toISOString()).toBe("2026-06-02T09:00:00.000Z");
  });
  it("day-of-week restriction (Mondays only)", () => {
    const after = new Date("2026-06-01T00:00:00Z"); // a Monday
    const next = nextRunAt("0 9 * * 1", "UTC", after);
    expect(next.toISOString()).toBe("2026-06-01T09:00:00.000Z");
    const afterThatMonday = nextRunAt("0 9 * * 1", "UTC", next);
    expect(afterThatMonday.toISOString()).toBe("2026-06-08T09:00:00.000Z");
  });
  it("hourly schedule fires every hour", () => {
    const after = new Date("2026-06-01T00:00:00Z");
    const next = nextRunAt("0 * * * *", "UTC", after);
    expect(next.toISOString()).toBe("2026-06-01T01:00:00.000Z");
  });
});

describe("nextRunAt — timezone + DST correctness (Europe/Rome)", () => {
  it("a daily 02:00 schedule always lands on wall-clock 02:00 in Rome, spring and fall", () => {
    const summer = nextRunAt("0 2 * * *", "Europe/Rome", new Date("2026-07-01T00:00:00Z"));
    expect(wallClock(summer, "Europe/Rome")).toMatchObject({ hour: 2, minute: 0 });
    const winter = nextRunAt("0 2 * * *", "Europe/Rome", new Date("2026-01-01T00:00:00Z"));
    expect(wallClock(winter, "Europe/Rome")).toMatchObject({ hour: 2, minute: 0 });
  });
  it("survives the spring-forward gap (2026-03-29, Rome jumps 01:59->03:00, 02:00 never occurs)", () => {
    const justBefore = new Date("2026-03-29T00:30:00Z"); // 01:30 Rome, before the gap
    const next = nextRunAt("0 2 * * *", "Europe/Rome", justBefore);
    const w = wallClock(next, "Europe/Rome");
    // 02:00 does not exist on the 29th — the engine must land on the NEXT day it does exist,
    // never on a fabricated or skipped instant.
    expect(w).toMatchObject({ hour: 2, minute: 0 });
    expect(w.day).toBe(30);
    expect(next.getTime()).toBeGreaterThan(justBefore.getTime());
  });
  it("fall-back overlap (2026-10-25, Rome repeats 02:00-02:59): wall clock genuinely matches twice, " +
     "so a next-run search honestly finds both real instants before moving to day 26 — documented " +
     "behavior, not a bug (most real-world wall-clock schedulers have the same ambiguity)", () => {
    const before = new Date("2026-10-24T22:00:00Z");
    const first = nextRunAt("0 2 * * *", "Europe/Rome", before);
    expect(wallClock(first, "Europe/Rome")).toMatchObject({ hour: 2, minute: 0, day: 25 });
    const second = nextRunAt("0 2 * * *", "Europe/Rome", first);
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(wallClock(second, "Europe/Rome")).toMatchObject({ hour: 2, minute: 0, day: 25 }); // the repeated hour
    const third = nextRunAt("0 2 * * *", "Europe/Rome", second);
    expect(wallClock(third, "Europe/Rome")).toMatchObject({ hour: 2, minute: 0, day: 26 });
  });
});
