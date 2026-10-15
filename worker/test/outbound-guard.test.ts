/**
 * Worker-side outbound guard tests. Prisma is mocked (this file asserts the guard's decisions,
 * the API integration suite proves the same logic against real Postgres). `fetch` is spied on:
 * a blocked send must throw BEFORE any network call is made. Nothing here reaches a provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settingRows = new Map<string, unknown>();
let settingReadFails = false;

vi.mock("../src/lib/prisma", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (settingReadFails) throw new Error("database unreachable");
        return settingRows.has(where.key) ? { key: where.key, value: settingRows.get(where.key) } : null;
      }),
    },
    publication: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "should-never-happen" }), { status: 200 }));

beforeEach(() => {
  settingRows.clear();
  settingReadFails = false;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertOutboundAllowed", () => {
  it("allows the send when the stop is off", async () => {
    const { assertOutboundAllowed } = await import("../src/lib/outbound-guard");
    await expect(assertOutboundAllowed("whatsapp_send", "execute")).resolves.toBeUndefined();
  });

  it("refuses with an emergency_stop error when the stop is on", async () => {
    settingRows.set("autopilotStop", true);
    const { assertOutboundAllowed, OutboundBlockedError } = await import("../src/lib/outbound-guard");
    const err = await assertOutboundAllowed("video_publish", "execute").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutboundBlockedError);
    expect((err as InstanceType<typeof OutboundBlockedError>).reason).toBe("emergency_stop");
    expect((err as InstanceType<typeof OutboundBlockedError>).phase).toBe("execute");
  });

  it("fails closed when the stop state cannot be read: nothing is sent", async () => {
    settingReadFails = true;
    const { assertOutboundAllowed, OutboundBlockedError } = await import("../src/lib/outbound-guard");
    const err = await assertOutboundAllowed("email_send", "execute").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OutboundBlockedError);
    expect((err as InstanceType<typeof OutboundBlockedError>).reason).toBe("state_unavailable");
  });

  it("reads the flag fresh on every call, so a stop set between two calls is honoured by the second", async () => {
    const { assertOutboundAllowed } = await import("../src/lib/outbound-guard");
    await expect(assertOutboundAllowed("social_publish", "execute")).resolves.toBeUndefined();
    settingRows.set("autopilotStop", true);
    await expect(assertOutboundAllowed("social_publish", "execute")).rejects.toThrow(/emergency stop/);
  });
});

describe("publish and send entry points stop before any network call", () => {
  it("publishVideo throws OutboundBlockedError and never calls fetch while stopped", async () => {
    settingRows.set("autopilotStop", true);
    const { publishVideo } = await import("../src/delivery/publish");
    const { isOutboundBlocked } = await import("../src/lib/outbound-guard");
    const err = await publishVideo("vj_1", "instagram").catch((e: unknown) => e);
    expect(isOutboundBlocked(err)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishCarousel throws OutboundBlockedError and never calls fetch while stopped", async () => {
    settingRows.set("autopilotStop", true);
    const { publishCarousel } = await import("../src/delivery/publish-carousel");
    const { isOutboundBlocked } = await import("../src/lib/outbound-guard");
    const err = await publishCarousel("cj_1", "linkedin").catch((e: unknown) => e);
    expect(isOutboundBlocked(err)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the WhatsApp template sender throws before building any request while stopped", async () => {
    settingRows.set("autopilotStop", true);
    const { sendWhatsAppTemplate } = await import("../src/lib/whatsapp-template");
    const { isOutboundBlocked } = await import("../src/lib/outbound-guard");
    const err = await sendWhatsAppTemplate({ accessToken: "t", phoneNumberId: "1" }, "+15550001111", "welcome_d1", ["a", "b"]).catch((e: unknown) => e);
    expect(isOutboundBlocked(err)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("internal traffic is not blocked", () => {
  it("the stop does not affect the worker's own Telegram team alerts (guard is not applied to them)", async () => {
    settingRows.set("autopilotStop", true);
    const source = await import("node:fs").then((fs) => fs.promises.readFile(new URL("../src/delivery/telegram.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/assertOutboundAllowed/);
  });
});
