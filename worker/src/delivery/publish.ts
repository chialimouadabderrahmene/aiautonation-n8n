import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { requireConnected } from "../lib/credentials";
import { getConnectedAccountCreds } from "../lib/connected-accounts";
import { getStorage } from "../lib/storage";
import { timedFetch, describeHttpFailure, readErrorDetail, ProviderError } from "../lib/http";

/**
 * Publishing an APPROVED video to the targets chosen on the project.
 * Tokens come from the Control Center's OAuth connections (encrypted vault).
 * Platforms that fetch the file themselves (Instagram, Facebook) get a
 * short-lived signed URL; X and LinkedIn receive the bytes directly.
 *
 * NOTE: these adapters follow each platform's documented API; they have not
 * been exercised against live accounts from this repository (no accounts
 * were available) — the Publication row records the platform's exact error.
 */

export interface PublishResult {
  externalId: string;
  externalUrl?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(provider: string, url: string, init: RequestInit, timeoutMs = 60_000): Promise<T> {
  const { res } = await timedFetch(url, init, timeoutMs);
  if (!res.ok) throw describeHttpFailure(provider, res.status, await readErrorDetail(res));
  return (await res.json()) as T;
}

function captionFor(job: { caption: string | null; hashtags: string[]; project: { cta: string | null; name: string } }, max: number): string {
  const tags = job.hashtags.join(" ");
  const base = [job.caption ?? job.project.name, job.project.cta ?? ""].filter(Boolean).join("\n\n");
  const full = tags ? `${base}\n\n${tags}` : base;
  return full.length <= max ? full : `${full.slice(0, max - 1)}…`;
}

async function withLocalFile<T>(storageKey: string, fn: (file: string, size: number) => Promise<T>): Promise<T> {
  const tmp = path.join(os.tmpdir(), `eki-pub-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  try {
    await getStorage().downloadToFile(storageKey, tmp);
    return await fn(tmp, (await fs.promises.stat(tmp)).size);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

type Job = Awaited<ReturnType<typeof loadJob>>;

async function loadJob(videoJobId: string) {
  const job = await prisma.videoJob.findUniqueOrThrow({ where: { id: videoJobId }, include: { project: true, assets: true, approval: true } });
  const final = job.assets.find((a) => a.type === "FINAL");
  if (!final) throw new ProviderError("No final video to publish", null, false);
  if (job.approval?.status !== "APPROVED") throw new ProviderError("Video is not approved", null, false);
  return { ...job, final };
}

async function publishInstagram(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const ver = v.graphVersion || "v23.0";
  if (!v.instagramUserId) throw new ProviderError("No Instagram business account is linked to the connected Facebook Page", null, false);
  const videoUrl = await getStorage().signedUrl(job.final.url, 3600);
  const params = new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption: captionFor(job, 2200), share_to_feed: "true", access_token: v.pageAccessToken ?? "" });
  const container = await json<{ id: string }>("Instagram", `https://graph.facebook.com/${ver}/${v.instagramUserId}/media`, { method: "POST", body: params });
  for (let i = 0; i < 60; i++) {
    const s = await json<{ status_code?: string; status?: string }>("Instagram", `https://graph.facebook.com/${ver}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(v.pageAccessToken ?? "")}`, {});
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new ProviderError(`Instagram could not process the video: ${s.status ?? s.status_code}`, null, false);
    if (i === 59) throw new ProviderError("Instagram processing timed out", null, true);
    await sleep(10_000);
  }
  const published = await json<{ id: string }>("Instagram", `https://graph.facebook.com/${ver}/${v.instagramUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: container.id, access_token: v.pageAccessToken ?? "" }),
  });
  const link = await json<{ permalink?: string }>("Instagram", `https://graph.facebook.com/${ver}/${published.id}?fields=permalink&access_token=${encodeURIComponent(v.pageAccessToken ?? "")}`, {}).catch(() => ({ permalink: undefined }));
  return { externalId: published.id, externalUrl: link.permalink };
}

async function publishFacebook(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const ver = v.graphVersion || "v23.0";
  if (!v.pageId) throw new ProviderError("No Facebook Page is connected", null, false);
  const fileUrl = await getStorage().signedUrl(job.final.url, 3600);
  const res = await json<{ id: string }>(
    "Facebook",
    `https://graph-video.facebook.com/${ver}/${v.pageId}/videos`,
    { method: "POST", body: new URLSearchParams({ file_url: fileUrl, description: captionFor(job, 5000), access_token: v.pageAccessToken ?? "" }) },
    300_000,
  );
  return { externalId: res.id, externalUrl: `https://www.facebook.com/${res.id}` };
}

async function publishX(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const auth = { Authorization: `Bearer ${v.accessToken}` };
  return withLocalFile(job.final.url, async (file, size) => {
    const init = await json<{ data: { id: string } }>("X", "https://api.x.com/2/media/upload/initialize", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "video/mp4", total_bytes: size, media_category: "tweet_video" }),
    });
    const mediaId = init.data.id;
    const CHUNK = 4 * 1024 * 1024;
    const fd = await fs.promises.open(file, "r");
    try {
      for (let offset = 0, index = 0; offset < size; offset += CHUNK, index++) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - offset));
        await fd.read(buf, 0, buf.length, offset);
        const form = new FormData();
        form.set("segment_index", String(index));
        form.set("media", new Blob([buf], { type: "application/octet-stream" }), "chunk");
        const { res } = await timedFetch(`https://api.x.com/2/media/upload/${mediaId}/append`, { method: "POST", headers: auth, body: form }, 120_000);
        if (!res.ok) throw describeHttpFailure("X", res.status, await readErrorDetail(res));
      }
    } finally {
      await fd.close();
    }
    let info = (await json<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>("X", `https://api.x.com/2/media/upload/${mediaId}/finalize`, { method: "POST", headers: auth })).data.processing_info;
    for (let i = 0; info && info.state !== "succeeded"; i++) {
      if (info.state === "failed") throw new ProviderError("X could not process the video", null, false);
      if (i > 60) throw new ProviderError("X video processing timed out", null, true);
      await sleep((info.check_after_secs ?? 5) * 1000);
      info = (await json<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>("X", `https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId}`, { headers: auth })).data.processing_info;
    }
    const tweet = await json<{ data: { id: string } }>("X", "https://api.x.com/2/tweets", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: captionFor(job, 280), media: { media_ids: [mediaId] } }),
    });
    return { externalId: tweet.data.id, externalUrl: `https://x.com/i/web/status/${tweet.data.id}` };
  });
}

function linkedinVersion(): string {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  // LinkedIn ships monthly versions and supports each for ~a year: use one from 3 months ago.
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 3);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function publishLinkedIn(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const owner = v.organizationId ? `urn:li:organization:${v.organizationId}` : `urn:li:person:${v.memberId}`;
  if (!v.organizationId && !v.memberId) throw new ProviderError("LinkedIn member id unknown — reconnect the account", null, false);
  const headers = { Authorization: `Bearer ${v.accessToken}`, "LinkedIn-Version": linkedinVersion(), "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
  return withLocalFile(job.final.url, async (file, size) => {
    const init = await json<{ value: { video: string; uploadToken?: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>(
      "LinkedIn",
      "https://api.linkedin.com/rest/videos?action=initializeUpload",
      { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } }) },
    );
    const etags: string[] = [];
    const fd = await fs.promises.open(file, "r");
    try {
      for (const part of init.value.uploadInstructions) {
        const buf = Buffer.alloc(part.lastByte - part.firstByte + 1);
        await fd.read(buf, 0, buf.length, part.firstByte);
        const { res } = await timedFetch(part.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf }, 300_000);
        if (!res.ok) throw describeHttpFailure("LinkedIn upload", res.status, await readErrorDetail(res));
        etags.push(res.headers.get("etag") ?? "");
      }
    } finally {
      await fd.close();
    }
    const { res: fin } = await timedFetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
      method: "POST",
      headers,
      body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? "", uploadedPartIds: etags } }),
    });
    if (!fin.ok) throw describeHttpFailure("LinkedIn", fin.status, await readErrorDetail(fin));
    const { res: post } = await timedFetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        author: owner,
        commentary: captionFor(job, 2900),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { id: init.value.video, title: job.project.name.slice(0, 200) } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!post.ok) throw describeHttpFailure("LinkedIn", post.status, await readErrorDetail(post));
    const postUrn = post.headers.get("x-restli-id") ?? post.headers.get("x-linkedin-id") ?? init.value.video;
    return { externalId: postUrn, externalUrl: `https://www.linkedin.com/feed/update/${postUrn}` };
  });
}

const PUBLISHERS: Record<string, (job: Job, creds: Record<string, string>) => Promise<PublishResult>> = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  x: publishX,
  linkedin: publishLinkedIn,
};

/** `meta` backs both the instagram and facebook publish targets. */
const CREDS_PROVIDER: Record<string, { provider: string; label: string }> = {
  instagram: { provider: "meta", label: "Meta" },
  facebook: { provider: "meta", label: "Meta" },
  x: { provider: "x", label: "X" },
  linkedin: { provider: "linkedin", label: "LinkedIn" },
};

/**
 * Publishes an approved video. With no `connectedAccountId`, this is the
 * original single-account-per-provider path (Integration's own OAuth
 * connection, unchanged). With one, it publishes through that specific
 * ConnectedAccount's own tokens instead — the multi-account path.
 */
export async function publishVideo(videoJobId: string, target: string, connectedAccountId?: string): Promise<PublishResult> {
  const publisher = PUBLISHERS[target];
  if (!publisher) throw new ProviderError(`Unknown publish target ${target}`, null, false);
  const legacy = CREDS_PROVIDER[target] ?? { provider: target, label: target };
  const creds = connectedAccountId ? await getConnectedAccountCreds(connectedAccountId) : await requireConnected(legacy.provider, legacy.label);
  return publisher(await loadJob(videoJobId), creds);
}
