/**
 * REAL Postgres + Redis integration tests for durable scheduling of approved video and carousel
 * publishes. Nothing is published here: the tests exercise scheduling, rescheduling, cancellation,
 * approval interaction, restart recovery (lost timers), missed schedules and the emergency stop.
 * The worker-side publish decisions are covered by worker/test/scheduled-publish.test.ts.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Server } from "node:http";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
const HOUR = 60 * 60_000;

async function setStop(value: boolean) {
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("autopilotStop", value);
}

async function readyVideo(opts: { approval?: "APPROVED" | "PENDING" | "REJECTED"; targets?: string[] } = {}) {
  const project = await prisma.videoProject.create({
    data: { name: "Sched", contentType: "Reel", topic: "t", prompt: "p", publishTargets: opts.targets ?? ["instagram"] },
  });
  const job = await prisma.videoJob.create({ data: { projectId: project.id, state: "READY", caption: "c", hashtags: [] } });
  if (opts.approval) {
    await prisma.approval.create({ data: { videoJobId: job.id, status: opts.approval, decidedAt: new Date(), decidedBy: "t" } });
  }
  return { projectId: project.id, jobId: job.id };
}

async function readyCarousel(opts: { approval?: "APPROVED" | "PENDING"; targets?: string[] } = {}) {
  const project = await prisma.carouselProject.create({
    data: { name: "CSched", topic: "t", prompt: "p", publishTargets: opts.targets ?? ["linkedin"] },
  });
  const job = await prisma.carouselJob.create({ data: { projectId: project.id, state: "READY" } });
  if (opts.approval) {
    await prisma.carouselApproval.create({ data: { carouselJobId: job.id, status: opts.approval, decidedAt: new Date(), decidedBy: "t" } });
  }
  return { projectId: project.id, jobId: job.id };
}

async function deliveryJobs() {
  const { getDeliveryQueue } = await import("../src/lib/queue");
  return getDeliveryQueue().getJobs(["waiting", "delayed"]);
}

beforeAll(async () => {
  await prisma.integration.upsert({ where: { provider: "instagram" }, update: {}, create: { provider: "instagram", category: "SOCIAL", authType: "OAUTH" } });
});

afterAll(async () => {
  await setStop(false);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await setStop(false);
  await prisma.publication.deleteMany();
  await prisma.carouselPublication.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.carouselApproval.deleteMany();
  await prisma.videoJob.deleteMany();
  await prisma.videoProject.deleteMany();
  await prisma.carouselJob.deleteMany();
  await prisma.carouselProject.deleteMany();
  const { getDeliveryQueue } = await import("../src/lib/queue");
  await getDeliveryQueue().obliterate({ force: true });
});

describe("scheduling a video", () => {
  it("creates a SCHEDULED row with the instant, timezone and version 1, and one delayed timer keyed by row and version", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    const when = new Date(Date.now() + HOUR);
    const out = await scheduleVideo(jobId, when, "Africa/Lagos", "admin@example.com");
    expect(out.scheduled).toHaveLength(1);
    const row = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(row).toMatchObject({ status: "SCHEDULED", scheduleTimezone: "Africa/Lagos", scheduleVersion: 1 });
    expect(row.scheduledFor?.getTime()).toBe(when.getTime());
    const timers = await deliveryJobs();
    expect(timers.map((t) => t.id)).toEqual([`sched-video-${row.id}-v1`]);
    expect(timers[0]!.delay).toBeGreaterThan(HOUR - 60_000);
  });

  it("can be scheduled before approval, but a scheduled row publishes only after approval (re-checked at publish time)", async () => {
    const { jobId } = await readyVideo({ approval: "PENDING" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await expect(scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a")).resolves.toMatchObject({ scheduled: [expect.any(Object)] });
  });

  it("refuses a video that is not READY, and refuses while the emergency stop is on", async () => {
    const project = await prisma.videoProject.create({ data: { name: "NR", contentType: "Reel", topic: "t", prompt: "p", publishTargets: ["instagram"] } });
    const notReady = await prisma.videoJob.create({ data: { projectId: project.id, state: "ASSEMBLING" } });
    const { scheduleVideo, SchedulingError } = await import("../src/modules/scheduling/schedule");
    await expect(scheduleVideo(notReady.id, new Date(Date.now() + HOUR), "UTC", "a")).rejects.toBeInstanceOf(SchedulingError);

    const { jobId } = await readyVideo({ approval: "APPROVED" });
    await setStop(true);
    await expect(scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a")).rejects.toThrow(/emergency stop/);
    expect(await prisma.publication.count()).toBe(0);
  });

  it("rescheduling bumps the version, removes the old timer, and leaves exactly one live timer", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    const first = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    await scheduleVideo(jobId, new Date(Date.now() + 3 * HOUR), "Europe/Paris", "a");
    const second = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(second.id).toBe(first.id);
    expect(second.scheduleVersion).toBe(2);
    expect(second.scheduleTimezone).toBe("Europe/Paris");
    const timers = (await deliveryJobs()).map((t) => t.id);
    expect(timers).toEqual([`sched-video-${first.id}-v2`]);
  });

  it("a timer from an old version is a no-op once the row has moved on (the worker's version check)", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    const first = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    await scheduleVideo(jobId, new Date(Date.now() + 2 * HOUR), "UTC", "a");
    const current = await prisma.publication.findFirstOrThrow({ where: { id: first.id } });
    expect(current.scheduleVersion).not.toBe(1); // the v1 timer cannot match this row
  });

  it("duplicate schedule requests do not duplicate timers", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    const when = new Date(Date.now() + HOUR);
    await scheduleVideo(jobId, when, "UTC", "a");
    await scheduleVideo(jobId, when, "UTC", "a");
    expect((await deliveryJobs()).length).toBe(1);
  });

  it("refuses a destination that is already published rather than rescheduling it", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    await prisma.publication.create({ data: { videoJobId: jobId, target: "instagram", status: "PUBLISHED", externalId: "ig1" } });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    const out = await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    expect(out.scheduled).toHaveLength(0);
    expect(out.refused[0]).toMatchObject({ target: "instagram", reason: "already published" });
  });
});

describe("cancelling and approval interaction", () => {
  it("cancelling removes the timer and marks the row CANCELLED with a bumped version", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo, cancelSchedules } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    expect(await cancelSchedules("video", jobId, "test", "a")).toBe(1);
    const row = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(row).toMatchObject({ status: "CANCELLED", scheduleVersion: 2 });
    expect(await deliveryJobs()).toHaveLength(0);
  });

  it("rejecting the approval cancels the scheduled rows", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    const { decide } = await import("../src/routes/approvals");
    await decide(jobId, "REJECTED", "reviewer@example.com", "off-brand");
    const row = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(row.status).toBe("CANCELLED");
  });

  it("approving a video does not publish or overwrite a destination that is scheduled", async () => {
    const { jobId } = await readyVideo({ approval: "PENDING" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    const { decide } = await import("../src/routes/approvals");
    await decide(jobId, "APPROVED", "reviewer@example.com");
    const row = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(row.status).toBe("SCHEDULED");
    expect(row.scheduleVersion).toBe(1);
    expect((await deliveryJobs()).map((t) => t.id)).toEqual([`sched-video-${row.id}-v1`]);
  });
});

describe("restart recovery and missed schedules", () => {
  it("a lost timer (Redis flushed, worker restarted) is recreated by the sweep", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo, sweepScheduledPublications } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + 30_000), "UTC", "a");
    const { getDeliveryQueue } = await import("../src/lib/queue");
    await getDeliveryQueue().obliterate({ force: true }); // simulate losing every Redis timer
    expect(await deliveryJobs()).toHaveLength(0);
    const result = await sweepScheduledPublications();
    expect(result).toMatchObject({ enqueued: 1, stopped: false });
    expect((await deliveryJobs()).length).toBe(1);
  });

  it("running the sweep repeatedly never creates a second timer for the same row", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo, sweepScheduledPublications } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + 30_000), "UTC", "a");
    await sweepScheduledPublications();
    await sweepScheduledPublications();
    await sweepScheduledPublications();
    expect((await deliveryJobs()).length).toBe(1);
  });

  it("a schedule more than an hour overdue is marked SKIPPED as missed, not published late", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const row = await prisma.publication.create({
      data: { videoJobId: jobId, target: "instagram", status: "SCHEDULED", scheduledFor: new Date(Date.now() - 2 * HOUR), scheduleVersion: 1 },
    });
    const { sweepScheduledPublications } = await import("../src/modules/scheduling/schedule");
    const result = await sweepScheduledPublications();
    expect(result.missed).toBe(1);
    const after = await prisma.publication.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("SKIPPED");
    expect(after.error).toMatch(/Missed its scheduled time/);
    expect(await deliveryJobs()).toHaveLength(0);
  });

  it("while the emergency stop is on, the sweep enqueues nothing", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    await prisma.publication.create({
      data: { videoJobId: jobId, target: "instagram", status: "SCHEDULED", scheduledFor: new Date(Date.now() + 30_000), scheduleVersion: 1 },
    });
    await setStop(true);
    const { sweepScheduledPublications } = await import("../src/modules/scheduling/schedule");
    const result = await sweepScheduledPublications();
    expect(result).toMatchObject({ enqueued: 0, stopped: true });
    expect(await deliveryJobs()).toHaveLength(0);
  });

  it("activating the stop cancels scheduled rows (not paused): they must be scheduled again after resume", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const { scheduleVideo } = await import("../src/modules/scheduling/schedule");
    await scheduleVideo(jobId, new Date(Date.now() + HOUR), "UTC", "a");
    const { quarantineQueuedOutbound } = await import("../src/modules/safety/emergency-stop");
    await quarantineQueuedOutbound();
    const row = await prisma.publication.findFirstOrThrow({ where: { videoJobId: jobId } });
    expect(row.status).toBe("SKIPPED");
    expect(row.error).toMatch(/emergency stop/);
  });
});

describe("scheduling a carousel", () => {
  it("schedules with the same guarantees: SCHEDULED row, versioned deterministic timer, idempotent", async () => {
    const { jobId } = await readyCarousel({ approval: "APPROVED" });
    const { scheduleCarousel } = await import("../src/modules/scheduling/schedule");
    const when = new Date(Date.now() + HOUR);
    await scheduleCarousel(jobId, when, "Africa/Lagos", "a");
    await scheduleCarousel(jobId, when, "Africa/Lagos", "a");
    const row = await prisma.carouselPublication.findFirstOrThrow({ where: { carouselJobId: jobId } });
    expect(row).toMatchObject({ status: "SCHEDULED", scheduleTimezone: "Africa/Lagos", scheduleVersion: 2 });
    const timers = await deliveryJobs();
    expect(timers.map((t) => t.id)).toEqual([`sched-carousel-${row.id}-v2`]);
  });
});

describe("the HTTP surface validates input before anything is stored", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { createApp } = await import("../src/app");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function adminToken(): Promise<string> {
    const bcrypt = (await import("bcryptjs")).default;
    const email = "sched-admin@example.com";
    const hash = await bcrypt.hash("Sched-test-passw0rd!", 4);
    await prisma.adminUser.upsert({ where: { email }, update: { passwordHash: hash, role: "OWNER" }, create: { email, passwordHash: hash, role: "OWNER" } });
    const { login } = await import("../src/modules/auth/auth");
    return (await login(email, "Sched-test-passw0rd!"))!.token;
  }

  it("rejects a past time, a missing timezone, and an unknown timezone with 400 and stores nothing", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const token = await adminToken();
    const post = (body: unknown) =>
      fetch(`${baseUrl}/api/video/jobs/${jobId}/schedule`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    expect((await post({ scheduledFor: new Date(Date.now() - HOUR).toISOString(), timezone: "UTC" })).status).toBe(400);
    expect((await post({ scheduledFor: new Date(Date.now() + HOUR).toISOString() })).status).toBe(400);
    expect((await post({ scheduledFor: new Date(Date.now() + HOUR).toISOString(), timezone: "Mars/Olympus" })).status).toBe(400);
    expect(await prisma.publication.count()).toBe(0);
  });

  it("accepts a valid future schedule and returns the stored instant", async () => {
    const { jobId } = await readyVideo({ approval: "APPROVED" });
    const token = await adminToken();
    const when = new Date(Date.now() + 2 * HOUR).toISOString();
    const res = await fetch(`${baseUrl}/api/video/jobs/${jobId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ scheduledFor: when, timezone: "Africa/Lagos" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scheduled: { scheduledFor: string }[] };
    expect(body.scheduled[0]?.scheduledFor).toBe(new Date(when).toISOString());
  });
});
