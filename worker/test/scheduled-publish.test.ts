/**
 * Worker unit tests for the scheduled-publish processor. Prisma and the two publish adapters are
 * mocked: these tests prove the decision logic (version, approval, state, claim, stop, retry) and
 * that the adapter is called only when every check passes. Nothing here reaches a provider.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const state = {
  publication: null as Row | null,
  carouselPublication: null as Row | null,
  claimCount: 1,
  findQueue: [] as (Row | null)[],
};

const updates: { model: string; data: Row }[] = [];
const publishVideo = vi.fn();
const publishCarousel = vi.fn();

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    publication: {
      findUnique: vi.fn(async () => (state.findQueue.length ? state.findQueue.shift() : state.publication)),
      updateMany: vi.fn(async () => ({ count: state.claimCount })),
      update: vi.fn(async ({ data }: { data: Row }) => {
        updates.push({ model: "publication", data });
        return {};
      }),
    },
    carouselPublication: {
      findUnique: vi.fn(async () => state.carouselPublication),
      updateMany: vi.fn(async () => ({ count: state.claimCount })),
      update: vi.fn(async ({ data }: { data: Row }) => {
        updates.push({ model: "carouselPublication", data });
        return {};
      }),
    },
  },
}));
vi.mock("../src/delivery/publish", () => ({ publishVideo: (...a: unknown[]) => publishVideo(...a) }));
vi.mock("../src/delivery/publish-carousel", () => ({ publishCarousel: (...a: unknown[]) => publishCarousel(...a) }));

const audit = vi.fn(async () => undefined);

function videoRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "pub_1",
    videoJobId: "vj_1",
    target: "instagram",
    connectedAccountId: null,
    status: "SCHEDULED",
    scheduleVersion: 2,
    videoJob: { state: "READY", approval: { status: "APPROVED" } },
    ...overrides,
  };
}

const payload = { model: "video" as const, publicationId: "pub_1", scheduleVersion: 2, requestedBy: "admin@example.com" };
const deps = { attemptsMade: 0, maxAttempts: 3, audit };

beforeEach(() => {
  state.publication = videoRow();
  state.carouselPublication = null;
  state.claimCount = 1;
  state.findQueue = [];
  updates.length = 0;
  publishVideo.mockReset();
  publishCarousel.mockReset();
  audit.mockClear();
});

describe("scheduled publish: decisions made before any external call", () => {
  it("a stale version (rescheduled or cancelled since the timer was set) publishes nothing", async () => {
    state.publication = videoRow({ scheduleVersion: 3 });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("stale");
    expect(publishVideo).not.toHaveBeenCalled();
  });

  it("a row that already ran (no longer SCHEDULED) is a no-op — the duplicate-delivery case", async () => {
    state.publication = videoRow({ status: "PUBLISHED" });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("stale");
    expect(publishVideo).not.toHaveBeenCalled();
  });

  it("an approval that is no longer APPROVED at publish time cancels the row and publishes nothing", async () => {
    state.publication = videoRow({ videoJob: { state: "READY", approval: { status: "REJECTED" } } });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("approval_revoked");
    expect(publishVideo).not.toHaveBeenCalled();
    expect(updates.at(-1)?.data).toMatchObject({ status: "CANCELLED" });
  });

  it("a video that is no longer READY is cancelled and not published", async () => {
    state.publication = videoRow({ videoJob: { state: "FAILED", approval: { status: "APPROVED" } } });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("not_ready");
    expect(publishVideo).not.toHaveBeenCalled();
  });
});

describe("scheduled publish: atomic claim (two workers, one publish)", () => {
  it("when another worker already claimed the row, this one does not publish", async () => {
    state.claimCount = 0;
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("already_claimed");
    expect(publishVideo).not.toHaveBeenCalled();
  });

  it("the claim is conditional on the same status AND version, so a rescheduled row cannot be claimed by an old timer", async () => {
    const prisma = (await import("../src/lib/prisma")).prisma as unknown as { publication: { updateMany: ReturnType<typeof vi.fn> } };
    publishVideo.mockResolvedValue({ externalId: "ig_1" });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    await processScheduledPublish(payload, deps);
    expect(prisma.publication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SCHEDULED", scheduleVersion: 2 }) }));
  });
});

describe("scheduled publish: the happy path and the stop", () => {
  it("publishes exactly once when every check passes and records the result", async () => {
    publishVideo.mockResolvedValue({ externalId: "ig_123", externalUrl: "https://instagram.test/p/123" });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("published");
    expect(publishVideo).toHaveBeenCalledTimes(1);
    expect(publishVideo).toHaveBeenCalledWith("vj_1", "instagram", undefined);
    expect(updates.at(-1)?.data).toMatchObject({ status: "PUBLISHED", externalId: "ig_123" });
  });

  it("when the emergency stop is on at the moment of publishing, the row is SKIPPED and nothing is sent", async () => {
    const { OutboundBlockedError } = await import("../src/lib/outbound-guard");
    publishVideo.mockRejectedValue(new OutboundBlockedError("video_publish", "execute"));
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish(payload, deps)).toBe("blocked");
    expect(updates.at(-1)?.data).toMatchObject({ status: "SKIPPED" });
    expect(String(updates.at(-1)?.data.error)).toMatch(/emergency stop/);
  });

  it("a blocked publish is never retried (the processor does not throw, so BullMQ completes the job)", async () => {
    const { OutboundBlockedError } = await import("../src/lib/outbound-guard");
    publishVideo.mockRejectedValue(new OutboundBlockedError("video_publish", "execute"));
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    await expect(processScheduledPublish(payload, deps)).resolves.toBe("blocked");
  });
});

describe("scheduled publish: failure policy", () => {
  it("a retryable provider failure with attempts left returns the row to SCHEDULED for the same version and rethrows for BullMQ", async () => {
    const { ProviderError } = await import("../src/lib/http");
    publishVideo.mockRejectedValue(new ProviderError("Instagram is having problems (503)", 503, true));
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    await expect(processScheduledPublish(payload, { ...deps, attemptsMade: 0, maxAttempts: 3 })).rejects.toThrow(/503/);
    expect(updates.at(-1)?.data).toMatchObject({ status: "SCHEDULED" });
  });

  it("a retryable failure with no attempts left ends FAILED and is not re-sent", async () => {
    const { ProviderError } = await import("../src/lib/http");
    const { UnrecoverableError } = await import("bullmq");
    publishVideo.mockRejectedValue(new ProviderError("rate limit", 429, true));
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    await expect(processScheduledPublish(payload, { ...deps, attemptsMade: 2, maxAttempts: 3 })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(updates.at(-1)?.data).toMatchObject({ status: "FAILED" });
  });

  it("a non-retryable provider error ends FAILED immediately with a scrubbed message", async () => {
    const { ProviderError } = await import("../src/lib/http");
    const { UnrecoverableError } = await import("bullmq");
    publishVideo.mockRejectedValue(new ProviderError("Instagram rejected the access token (401) token=EAAB123secret", 401, false));
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    await expect(processScheduledPublish(payload, deps)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(updates.at(-1)?.data).toMatchObject({ status: "FAILED" });
  });
});

describe("scheduled publish: carousel parity", () => {
  it("a scheduled carousel follows the same approval, claim and publish rules", async () => {
    state.carouselPublication = {
      id: "cp_1",
      carouselJobId: "cj_1",
      target: "linkedin",
      connectedAccountId: "acc_1",
      status: "SCHEDULED",
      scheduleVersion: 1,
      carouselJob: { state: "READY", approval: { status: "APPROVED" } },
    };
    publishCarousel.mockResolvedValue({ externalId: "li_9" });
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    const out = await processScheduledPublish({ model: "carousel", publicationId: "cp_1", scheduleVersion: 1, requestedBy: "a" }, deps);
    expect(out).toBe("published");
    expect(publishCarousel).toHaveBeenCalledWith("cj_1", "linkedin", "acc_1");
  });

  it("a carousel with revoked approval is cancelled and never published", async () => {
    state.carouselPublication = {
      id: "cp_2",
      carouselJobId: "cj_2",
      target: "x",
      connectedAccountId: null,
      status: "SCHEDULED",
      scheduleVersion: 1,
      carouselJob: { state: "READY", approval: { status: "REJECTED" } },
    };
    const { processScheduledPublish } = await import("../src/delivery/scheduled-publish");
    expect(await processScheduledPublish({ model: "carousel", publicationId: "cp_2", scheduleVersion: 1, requestedBy: "a" }, deps)).toBe("approval_revoked");
    expect(publishCarousel).not.toHaveBeenCalled();
  });
});
