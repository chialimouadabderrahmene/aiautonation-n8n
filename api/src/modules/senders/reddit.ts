import { timedFetch, describeHttpFailure, readErrorDetail, withRetry } from "../../lib/http";

export interface RedditPost {
  title: string;
  selftext: string;
  ups: number;
}

export type RedditSearchResult = { ok: true; posts: RedditPost[] } | { ok: false; reason: "provider_error"; message: string };

/**
 * Reddit's public search JSON endpoint — the same `GET /r/{subs}/search.json` call
 * n8n 16-pain-discovery-engine's "Fetch Reddit" node made (confirmed from that node's own URL,
 * not guessed). No API key is required for this endpoint, only a descriptive User-Agent, which
 * Reddit's API rules require. The URL is built ENTIRELY from Reddit's own fixed host and path
 * pattern — subreddits/query/sort/time are interpolated into path/query segments, never into a
 * caller-supplied base URL — so this can only ever reach reddit.com, never an arbitrary or
 * internal host (the same SSRF constraint every other action in this engine holds to).
 */
export async function searchRedditPosts(input: { subreddits: string[]; query: string; sort?: string; time?: string; limit?: number }): Promise<RedditSearchResult> {
  const subs = input.subreddits.map((s) => s.replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean).join("+");
  const params = new URLSearchParams({
    q: input.query,
    restrict_sr: "1",
    sort: input.sort ?? "top",
    t: input.time ?? "week",
    limit: String(Math.min(100, Math.max(1, input.limit ?? 20))),
  });
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch(
        `https://www.reddit.com/r/${subs}/search.json?${params.toString()}`,
        { headers: { "User-Agent": "EkiPainDiscovery/1.0 (contact: team)" } },
        15_000,
      );
      if (!res.ok) throw describeHttpFailure("Reddit", res.status, await readErrorDetail(res));
      return (await res.json()) as { data?: { children?: { data?: Record<string, unknown> }[] } };
    });
    const posts = (data.data?.children ?? [])
      .map((c) => c.data ?? {})
      .filter((d): d is Record<string, unknown> => typeof d.title === "string" && d.title.length > 0)
      .map((d) => ({ title: String(d.title), selftext: String(d.selftext ?? ""), ups: Number(d.ups ?? 0) }));
    return { ok: true, posts };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
