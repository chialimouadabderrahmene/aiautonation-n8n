import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry } from "../../lib/http";

export type RunActorResult = { ok: true; items: unknown[] } | { ok: false; reason: "not_configured" | "provider_error"; message: string };

/**
 * Runs the configured Apify actor synchronously and returns its dataset items — the same
 * `POST /v2/acts/{actorId}/run-sync-get-dataset-items` call n8n 15-viral-intelligence-engine's
 * "Run Apify Actor" node made, confirmed from that node's own URL construction (not guessed).
 * Reads the actor id and its JSON input from the Apify integration's OWN stored config
 * (`trendsActorId`/`trendsInputJson`), exactly like n8n read them from
 * APIFY_TRENDS_ACTOR_ID/APIFY_TRENDS_INPUT_JSON — never from the workflow definition, since
 * that config is operator-owned, not business-logic.
 */
export async function runTrendsActor(): Promise<RunActorResult> {
  const integration = await prisma.integration.findUnique({ where: { provider: "apify" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "Apify is not connected." };
  const v = await getProviderValues("apify");
  if (!v?.apiToken || !v?.trendsActorId) return { ok: false, reason: "not_configured", message: "Apify token or trends actor ID missing." };
  const apiToken = v.apiToken;
  const trendsActorId = v.trendsActorId;
  let actorInput: unknown = {};
  try {
    actorInput = JSON.parse(v.trendsInputJson || "{}");
  } catch {
    return { ok: false, reason: "not_configured", message: "Apify actor input JSON (Integrations → Apify) is not valid JSON." };
  }
  try {
    const items = await withRetry(async () => {
      const { res } = await timedFetch(
        `https://api.apify.com/v2/acts/${encodeURIComponent(trendsActorId)}/run-sync-get-dataset-items`,
        { method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify(actorInput) },
        180_000, // actor runs can legitimately take minutes — matches the n8n node's own 180s timeout
      );
      if (!res.ok) throw describeHttpFailure("Apify", res.status, await readErrorDetail(res));
      return (await res.json()) as unknown[];
    });
    return { ok: true, items: Array.isArray(items) ? items : [] };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
