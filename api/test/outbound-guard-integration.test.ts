/**
 * REAL Postgres + Redis integration tests for the emergency stop and outbound guard.
 *
 * Provider traffic goes to a LOCAL MOCK (the existing ALLOW_PROVIDER_OVERRIDES test hook), which
 * counts every request it receives. "Blocked" is therefore proven by the mock receiving zero
 * requests, not by inspecting return values alone. Nothing here reaches a real provider.
 *
 * Run explicitly: DATABASE_URL=... REDIS_URL=... npm run test:integration
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import http from "node:http";
import type { Server } from "node:http";
import bcrypt from "bcryptjs";

process.env.ALLOW_PROVIDER_OVERRIDES = "true";

const prisma = new PrismaClient();
let mock: Server;
let mockHits = 0;
/** Runs before the mock answers — lets a test flip the stop "during processing". */
let onMockRequest: (() => Promise<void>) | null = null;

async function startMock(): Promise<number> {
  return new Promise((resolve) => {
    mock = http.createServer(async (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        mockHits += 1;
        if (onMockRequest) await onMockRequest();
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ id: `mock-${mockHits}`, message: "accepted by mock (test only)" }));
      });
    });
    mock.listen(0, "127.0.0.1", () => {
      const addr = mock.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

async function setStop(value: boolean, by = "test@example.com") {
  const { setSetting } = await import("../src/modules/settings/schema");
  await setSetting("autopilotStop", value);
  await setSetting("_emergencyStopChange", { at: new Date().toISOString(), by, active: value });
}

beforeAll(async () => {
  const port = await startMock();
  process.env.PROVIDER_API_OVERRIDES = JSON.stringify({ "api.resend.com": `http://127.0.0.1:${port}` });
  await prisma.integration.upsert({ where: { provider: "resend" }, update: {}, create: { provider: "resend", category: "EMAIL", authType: "API_KEY" } });
  const { saveCredentials } = await import("../src/modules/integrations/vault");
  await saveCredentials({ provider: "resend", secrets: { apiKey: "re_test_key_0000000000" }, config: { fromEmail: "Eki <hello@example.com>" } });
  await prisma.integration.update({ where: { provider: "resend" }, data: { status: "CONNECTED" } });
}, 20_000);

afterAll(async () => {
  // The stop lives in the shared test database: never leave it on for the next test file.
  await setStop(false);
  await new Promise<void>((resolve) => mock.close(() => resolve()));
  await prisma.$disconnect();
});

beforeEach(async () => {
  mockHits = 0;
  onMockRequest = null;
  await setStop(false);
  await prisma.publication.deleteMany();
  await prisma.carouselPublication.deleteMany();
  await prisma.videoJob.deleteMany();
  await prisma.videoProject.deleteMany();
  const { getDeliveryQueue } = await import("../src/lib/queue");
  await getDeliveryQueue().obliterate({ force: true });
});

describe("outbound guard — email (real code path, mock provider)", () => {
  it("sends when the stop is off, and the provider receives the request", async () => {
    const { sendEmail } = await import("../src/modules/senders/resend");
    const result = await sendEmail({ to: "buyer@example.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(result.ok).toBe(true);
    expect(mockHits).toBe(1);
  });

  it("refuses with reason emergency_stop when the stop is on, and the provider receives nothing", async () => {
    await setStop(true);
    const { sendEmail } = await import("../src/modules/senders/resend");
    const result = await sendEmail({ to: "buyer@example.com", subject: "Hi", html: "<p>Hi</p>" });
    expect(result).toMatchObject({ ok: false, reason: "emergency_stop" });
    expect(mockHits).toBe(0);
  });

  it("a send already past the check when the stop is flipped completes (in-flight), but the next send is refused", async () => {
    const { sendEmail } = await import("../src/modules/senders/resend");
    onMockRequest = () => setStop(true); // the stop is activated while the first request is in flight
    const first = await sendEmail({ to: "a@example.com", subject: "1", html: "<p>1</p>" });
    const second = await sendEmail({ to: "b@example.com", subject: "2", html: "<p>2</p>" });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "emergency_stop" });
    expect(mockHits).toBe(1);
  });

  it("the email.send engine action records a skip, not a failure, when stopped", async () => {
    await setStop(true);
    const { ACTION_REGISTRY } = await import("../src/modules/engine/actions");
    const out = (await ACTION_REGISTRY["email.send"]!.handler({ to: "buyer@example.com", subject: "x", html: "<p>x</p>" })) as { sent: boolean; reason?: string };
    expect(out).toMatchObject({ sent: false, reason: "emergency_stop" });
    expect(mockHits).toBe(0);
  });
});

describe("outbound guard — enqueue time", () => {
  it("refuses to enqueue a video publish while stopped, and nothing is added to the delivery queue", async () => {
    await setStop(true);
    const { enqueueDelivery, getDeliveryQueue } = await import("../src/lib/queue");
    const { OutboundBlockedError } = await import("../src/lib/outbound-guard");
    await expect(enqueueDelivery({ kind: "publish", videoJobId: "vj_x", target: "instagram", requestedBy: "t" })).rejects.toBeInstanceOf(OutboundBlockedError);
    const counts = await getDeliveryQueue().getJobCounts("waiting", "delayed", "active");
    expect(counts.waiting + counts.delayed + counts.active).toBe(0);
  });

  it("refuses to enqueue a carousel publish while stopped", async () => {
    await setStop(true);
    const { enqueueDelivery } = await import("../src/lib/queue");
    await expect(enqueueDelivery({ kind: "publish-carousel", carouselJobId: "cj_x", target: "x", requestedBy: "t" })).rejects.toThrow(/emergency stop/);
  });

  it("does not block internal Telegram approval traffic while stopped (team alerts are not customer-facing)", async () => {
    await setStop(true);
    const { enqueueDelivery, getDeliveryQueue } = await import("../src/lib/queue");
    await enqueueDelivery({ kind: "send-approval", videoJobId: "vj_x", requestedBy: "t" });
    expect((await getDeliveryQueue().getJobCounts("waiting", "delayed")).waiting).toBe(1);
  });
});

describe("outbound guard — quarantine of already-queued jobs", () => {
  it("activating the stop removes queued publish jobs and marks their pending publications SKIPPED", async () => {
    const project = await prisma.videoProject.create({ data: { name: "P", contentType: "Reel", topic: "t", prompt: "p" } });
    const job = await prisma.videoJob.create({ data: { projectId: project.id, state: "READY" } });
    await prisma.publication.create({ data: { videoJobId: job.id, target: "instagram", status: "PENDING" } });
    // Queued directly (bypassing enqueueDelivery) to model a job that was queued before the stop.
    const { getDeliveryQueue } = await import("../src/lib/queue");
    await getDeliveryQueue().add("publish", { kind: "publish", videoJobId: job.id, target: "instagram", requestedBy: "t" }, { delay: 60_000 });

    const { quarantineQueuedOutbound } = await import("../src/modules/safety/emergency-stop");
    const result = await quarantineQueuedOutbound();
    expect(result.removedJobs).toBe(1);
    expect(result.markedPublications).toBe(1);
    const pub = await prisma.publication.findFirstOrThrow({ where: { videoJobId: job.id } });
    expect(pub.status).toBe("SKIPPED");
    expect(pub.error).toMatch(/emergency stop/);
    expect((await getDeliveryQueue().getJobCounts("waiting", "delayed")).delayed).toBe(0);
  });

  it("leaves already-published rows and internal jobs alone", async () => {
    const project = await prisma.videoProject.create({ data: { name: "P2", contentType: "Reel", topic: "t", prompt: "p" } });
    const job = await prisma.videoJob.create({ data: { projectId: project.id, state: "READY" } });
    await prisma.publication.create({ data: { videoJobId: job.id, target: "x", status: "PUBLISHED", externalId: "tw1" } });
    const { quarantineQueuedOutbound } = await import("../src/modules/safety/emergency-stop");
    await quarantineQueuedOutbound();
    const pub = await prisma.publication.findFirstOrThrow({ where: { videoJobId: job.id } });
    expect(pub.status).toBe("PUBLISHED");
    expect(pub.externalId).toBe("tw1");
  });
});

describe("emergency stop — settings route authorization and audit", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const { createApp } = await import("../src/app");
    const app = createApp();
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function tokenFor(role: "OWNER" | "ADMIN" | "VIEWER"): Promise<string> {
    const email = `${role.toLowerCase()}-stop@example.com`;
    const hash = await bcrypt.hash("Stop-test-passw0rd!", 4);
    await prisma.adminUser.upsert({ where: { email }, update: { role, passwordHash: hash }, create: { email, role, passwordHash: hash } });
    const { login } = await import("../src/modules/auth/auth");
    const res = await login(email, "Stop-test-passw0rd!");
    if (!res) throw new Error("login failed in test");
    return res.token;
  }

  async function putStop(token: string, value: boolean) {
    return fetch(`${baseUrl}/api/settings/autopilotStop`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value }),
    });
  }

  it("an ADMIN can activate the stop", async () => {
    const res = await putStop(await tokenFor("ADMIN"), true);
    expect(res.status).toBe(200);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "autopilotStop" } })).value).toBe(true);
  });

  it("an ADMIN cannot resume outbound sending (403) and the stop stays on", async () => {
    await setStop(true);
    const res = await putStop(await tokenFor("ADMIN"), false);
    expect(res.status).toBe(403);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "autopilotStop" } })).value).toBe(true);
  });

  it("an OWNER can resume, and the change is audited with who and when", async () => {
    await setStop(true);
    const res = await putStop(await tokenFor("OWNER"), false);
    expect(res.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: "emergency_stop.resumed" }, orderBy: { createdAt: "desc" } });
    expect(audit?.actor).toBe("owner-stop@example.com");
  });

  it("a VIEWER cannot change the stop at all", async () => {
    const res = await putStop(await tokenFor("VIEWER"), true);
    expect(res.status).toBe(403);
  });

  it("activation records an audit entry and the quarantine summary", async () => {
    const res = await putStop(await tokenFor("ADMIN"), true);
    const body = (await res.json()) as { quarantine: { removedJobs: number; markedPublications: number } };
    expect(body.quarantine).toMatchObject({ removedJobs: expect.any(Number), markedPublications: expect.any(Number) });
    const audit = await prisma.auditLog.findFirst({ where: { action: "emergency_stop.activated" }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
  });
});
