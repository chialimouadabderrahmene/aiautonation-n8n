import { describe, it, expect } from "vitest";
import { calculateWeeklyAnalytics, formatTelegramDigest, LeadRecord, ContentRecord, ExecutionRecord } from "../src/pipeline/weekly-report";

const DAY = 86_400_000;
const now = new Date("2026-01-15T09:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

describe("calculateWeeklyAnalytics (native port of n8n workflow 09's Calculate Analytics)", () => {
  it("buckets leads into this week vs. previous week and computes WoW growth", () => {
    const leads: LeadRecord[] = [
      { source: "web", createdAt: daysAgo(2), isComplete: false },
      { source: "web", createdAt: daysAgo(3), isComplete: false },
      { source: "whatsapp", createdAt: daysAgo(10), isComplete: false },
    ];
    const a = calculateWeeklyAnalytics(leads, [], [], now);
    expect(a.newLeadsThisWeek).toBe(2);
    expect(a.newLeadsPrevWeek).toBe(1);
    expect(a.weekOverWeekGrowth).toBe("100.0");
    expect(a.wowTrend).toBe("up");
    expect(a.leadsBySource).toEqual({ web: 2 });
  });

  it("reports 100% growth off a zero baseline, and 0% off a zero start", () => {
    const some: LeadRecord[] = [{ source: "web", createdAt: daysAgo(1), isComplete: false }];
    expect(calculateWeeklyAnalytics(some, [], [], now).weekOverWeekGrowth).toBe("100.0");
    expect(calculateWeeklyAnalytics([], [], [], now).weekOverWeekGrowth).toBe("0.0");
    expect(calculateWeeklyAnalytics([], [], [], now).wowTrend).toBe("flat");
  });

  it("computes conversion rate from isComplete leads", () => {
    const leads: LeadRecord[] = [
      { source: "web", createdAt: daysAgo(1), isComplete: true },
      { source: "web", createdAt: daysAgo(1), isComplete: true },
      { source: "web", createdAt: daysAgo(1), isComplete: false },
      { source: "web", createdAt: daysAgo(1), isComplete: false },
    ];
    expect(calculateWeeklyAnalytics(leads, [], [], now).conversionRate).toBe("50.0");
  });

  it("buckets content into published > approved-not-published > pending, mutually exclusive", () => {
    const content: ContentRecord[] = [
      { createdAt: daysAgo(1), approved: true, published: true },
      { createdAt: daysAgo(1), approved: true, published: false },
      { createdAt: daysAgo(1), approved: false, published: false },
    ];
    const a = calculateWeeklyAnalytics([], content, [], now);
    expect(a.contentPublished).toBe(1);
    expect(a.contentApproved).toBe(1);
    expect(a.contentPending).toBe(1);
    expect(a.contentThisWeek).toBe(3);
  });

  it("computes automation success rate, or N/A with no runs", () => {
    const executions: ExecutionRecord[] = [{ status: "SUCCESS" }, { status: "SUCCESS" }, { status: "FAILED" }];
    expect(calculateWeeklyAnalytics([], [], executions, now).successRate).toBe("67");
    expect(calculateWeeklyAnalytics([], [], [], now).successRate).toBe("N/A");
  });
});

describe("formatTelegramDigest", () => {
  it("renders every section without throwing on an empty week", () => {
    const text = formatTelegramDigest(calculateWeeklyAnalytics([], [], [], now));
    expect(text).toContain("Weekly Growth Report");
    expect(text).toContain("Leads by source:\n  none");
  });
});
