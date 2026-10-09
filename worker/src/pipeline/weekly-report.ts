/**
 * Weekly growth report — native port of n8n workflow 09 ("Weekly Analytics
 * Report"), folding in workflow 22's one piece that wasn't pure duplication
 * (an AI narrative on top of the same numbers) only to the extent the
 * numbers themselves are real: everything below is computed from this
 * app's own Postgres, never from an invented baseline.
 *
 * Scope limits, disclosed rather than hidden: n8n's version also reported
 * feedback ratings, NPS, waitlist size and referral counts, all read from
 * Google Sheets tabs this app never replaced with a stored model (no
 * Feedback/Waitlist table exists natively, and nothing here writes a
 * "referral" source). Those lines are dropped rather than faked; everything
 * below is counted from tables this app actually writes:
 * WhatsAppContact (leads), VideoJob + CarouselJob (content),
 * AutomationExecution (this engine's own run health — new, n8n never had
 * visibility into this).
 */
import { prisma } from "../lib/prisma";

export interface LeadRecord {
  source: string;
  createdAt: Date;
  isComplete: boolean;
}

export interface ContentRecord {
  createdAt: Date;
  approved: boolean;
  published: boolean;
}

export interface ExecutionRecord {
  status: "SUCCESS" | "FAILED" | "RUNNING";
}

export interface WeeklyAnalytics {
  weekStart: string;
  weekEnd: string;
  totalLeads: number;
  newLeadsThisWeek: number;
  newLeadsPrevWeek: number;
  leadsBySource: Record<string, number>;
  totalSignups: number;
  conversionRate: string;
  weekOverWeekGrowth: string;
  wowTrend: "up" | "down" | "flat";
  totalContent: number;
  contentThisWeek: number;
  contentApproved: number;
  contentPending: number;
  contentPublished: number;
  executionsThisWeek: number;
  executionsSucceeded: number;
  executionsFailed: number;
  successRate: string;
}

const DAY_MS = 86_400_000;
const inRange = (d: Date, from: Date, to: Date) => d >= from && d < to;

/** Pure — no DB — so the week-over-week math and bucketing are directly testable. */
export function calculateWeeklyAnalytics(leads: LeadRecord[], content: ContentRecord[], executions: ExecutionRecord[], now: Date = new Date()): WeeklyAnalytics {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const justAfterNow = new Date(now.getTime() + 1);

  const newLeadsThisWeek = leads.filter((l) => inRange(l.createdAt, weekAgo, justAfterNow)).length;
  const newLeadsPrevWeek = leads.filter((l) => inRange(l.createdAt, twoWeeksAgo, weekAgo)).length;
  const leadsBySource: Record<string, number> = {};
  for (const l of leads.filter((l) => inRange(l.createdAt, weekAgo, justAfterNow))) leadsBySource[l.source || "unknown"] = (leadsBySource[l.source || "unknown"] || 0) + 1;

  const totalSignups = leads.filter((l) => l.isComplete).length;
  const conversionRate = leads.length ? ((totalSignups / leads.length) * 100).toFixed(1) : "0.0";
  const wowNum = newLeadsPrevWeek > 0 ? ((newLeadsThisWeek - newLeadsPrevWeek) / newLeadsPrevWeek) * 100 : newLeadsThisWeek > 0 ? 100 : 0;
  const weekOverWeekGrowth = wowNum.toFixed(1);
  const wowTrend: WeeklyAnalytics["wowTrend"] = wowNum > 0 ? "up" : wowNum < 0 ? "down" : "flat";

  const contentThisWeek = content.filter((c) => inRange(c.createdAt, weekAgo, justAfterNow));
  const published = content.filter((c) => c.published);
  const approvedNotPublished = content.filter((c) => c.approved && !c.published);
  const pending = content.filter((c) => !c.approved && !c.published);

  const execThisWeek = executions; // caller already scopes the query to the last 7 days
  const succeeded = execThisWeek.filter((e) => e.status === "SUCCESS").length;
  const failed = execThisWeek.filter((e) => e.status === "FAILED").length;
  const successRate = succeeded + failed ? ((succeeded / (succeeded + failed)) * 100).toFixed(0) : "N/A";

  return {
    weekStart: weekAgo.toISOString().slice(0, 10),
    weekEnd: now.toISOString().slice(0, 10),
    totalLeads: leads.length,
    newLeadsThisWeek,
    newLeadsPrevWeek,
    leadsBySource,
    totalSignups,
    conversionRate,
    weekOverWeekGrowth,
    wowTrend,
    totalContent: content.length,
    contentThisWeek: contentThisWeek.length,
    contentApproved: approvedNotPublished.length,
    contentPending: pending.length,
    contentPublished: published.length,
    executionsThisWeek: execThisWeek.length,
    executionsSucceeded: succeeded,
    executionsFailed: failed,
    successRate,
  };
}

export function formatTelegramDigest(a: WeeklyAnalytics): string {
  const sources = Object.entries(a.leadsBySource).map(([s, c]) => `  ${s}: ${c}`).join("\n") || "  none";
  return [
    "Weekly Growth Report",
    `${a.weekStart} -> ${a.weekEnd}`,
    "",
    `New leads: ${a.newLeadsThisWeek} (${a.wowTrend} ${a.weekOverWeekGrowth}% WoW)`,
    `Total leads: ${a.totalLeads} | Conversion: ${a.conversionRate}%`,
    `Leads by source:\n${sources}`,
    "",
    `Content: created ${a.contentThisWeek}, approved ${a.contentApproved}, pending ${a.contentPending}, published ${a.contentPublished}`,
    "",
    `Automation runs this week: ${a.executionsThisWeek} (${a.successRate}% success, ${a.executionsFailed} failed)`,
  ].join("\n");
}

export async function runWeeklyReport(): Promise<WeeklyAnalytics> {
  // Leads/content are fetched in full — the pure function does its own
  // this-week/prev-week windowing over them (it needs prior-week leads too,
  // for the week-over-week comparison). Executions only ever need "this
  // week", so that query is pre-filtered.
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [contacts, videoJobs, carouselJobs, executions] = await Promise.all([
    prisma.whatsAppContact.findMany({ select: { source: true, createdAt: true, status: true } }),
    prisma.videoJob.findMany({ select: { createdAt: true, approval: { select: { status: true } }, publications: { select: { status: true } } } }),
    prisma.carouselJob.findMany({ select: { createdAt: true, approval: { select: { status: true } }, publications: { select: { status: true } } } }),
    prisma.automationExecution.findMany({ where: { startedAt: { gte: weekAgo } }, select: { status: true } }),
  ]);

  const leads: LeadRecord[] = contacts.map((c) => ({ source: c.source ?? "unknown", createdAt: c.createdAt, isComplete: c.status === "COMPLETE" }));
  const content: ContentRecord[] = [...videoJobs, ...carouselJobs].map((j) => ({
    createdAt: j.createdAt,
    approved: j.approval?.status === "APPROVED",
    published: j.publications.some((p) => p.status === "PUBLISHED"),
  }));
  const execRecords: ExecutionRecord[] = executions.map((e) => ({ status: e.status as ExecutionRecord["status"] }));

  return calculateWeeklyAnalytics(leads, content, execRecords);
}
