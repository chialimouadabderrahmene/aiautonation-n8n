import { outboundStopResult } from "../../lib/outbound-guard";
import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry } from "../../lib/http";

export type SendSocialResult = { ok: true; providerId: string } | { ok: false; reason: "not_configured" | "provider_error" | "emergency_stop"; message: string };

/**
 * Posts a real tweet via X's documented API v2 endpoint (POST /2/tweets, JSON body {text},
 * OAuth 2.0 Bearer token) — the same call n8n 10/12's "Post to Twitter X" node made. The
 * access token is kept fresh by the existing modules/oauth/oauth.ts refreshExpiringTokens()
 * background job (already scheduled — this file does not duplicate token-refresh logic).
 */
export async function postTweet(text: string): Promise<SendSocialResult> {
  const stopped = await outboundStopResult("social_publish");
  if (stopped) return stopped;
  const integration = await prisma.integration.findUnique({ where: { provider: "x" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "X is not connected." };
  const v = await getProviderValues("x");
  if (!v?.accessToken) return { ok: false, reason: "not_configured", message: "X access token missing." };
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: { Authorization: `Bearer ${v.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw describeHttpFailure("X", res.status, await readErrorDetail(res));
      return (await res.json()) as { data?: { id?: string } };
    });
    const id = data.data?.id;
    if (!id) return { ok: false, reason: "provider_error", message: "X accepted the request but returned no tweet id." };
    return { ok: true, providerId: id };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Posts via Buffer's legacy "create update" endpoint (POST /1/updates/create.json, Bearer
 * access token, {text, profile_ids:[id], now:true}) — the same call n8n 10/12's "Post via
 * Buffer" node made. `caveat` on the Buffer provider definition already flags that this shape
 * has never been confirmed against a live Buffer account (Buffer no longer registers new OAuth
 * apps for it) — that caveat still applies; this function implements the documented contract,
 * it does not newly verify it against a real account.
 */
export async function postToBuffer(text: string, profileId: string): Promise<SendSocialResult> {
  const stopped = await outboundStopResult("social_publish");
  if (stopped) return stopped;
  const integration = await prisma.integration.findUnique({ where: { provider: "buffer" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "Buffer is not connected." };
  const v = await getProviderValues("buffer");
  if (!v?.accessToken) return { ok: false, reason: "not_configured", message: "Buffer access token missing." };
  if (!profileId) return { ok: false, reason: "not_configured", message: "No Buffer profile ID configured for this platform." };
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch("https://api.bufferapp.com/1/updates/create.json", {
        method: "POST",
        headers: { Authorization: `Bearer ${v.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, profile_ids: [profileId], now: true }),
      });
      if (!res.ok) throw describeHttpFailure("Buffer", res.status, await readErrorDetail(res));
      return (await res.json()) as { success?: boolean; updates?: { id?: string }[] };
    });
    if (data.success !== true) return { ok: false, reason: "provider_error", message: "Buffer reported success=false." };
    const id = data.updates?.[0]?.id;
    return { ok: true, providerId: id ?? "unknown" };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
