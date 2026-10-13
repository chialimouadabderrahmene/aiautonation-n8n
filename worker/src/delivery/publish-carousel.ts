import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { requireConnected } from "../lib/credentials";
import { getConnectedAccountCreds } from "../lib/connected-accounts";
import { getStorage } from "../lib/storage";
import { timedFetch, describeHttpFailure, readErrorDetail, ProviderError } from "../lib/http";
import { PublishResult } from "./publish";

/**
 * Publishing an APPROVED carousel to the targets chosen on the project.
 * Exact mirror of publish.ts's per-platform pattern, for a set of slide
 * images instead of one rendered video — Instagram/Facebook fetch the files
 * themselves from a signed URL, X and LinkedIn receive the bytes directly.
 *
 * NOTE: same caveat as publish.ts — these follow each platform's documented
 * multi-image API; they have not been exercised against live accounts from
 * this repository (no accounts were available). The CarouselPublication row
 * records the platform's exact error.
 */

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
  const tmp = path.join(os.tmpdir(), `eki-pub-car-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  try {
    await getStorage().downloadToFile(storageKey, tmp);
    return await fn(tmp, (await fs.promises.stat(tmp)).size);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

type Job = Awaited<ReturnType<typeof loadJob>>;

async function loadJob(carouselJobId: string) {
  const job = await prisma.carouselJob.findUniqueOrThrow({ where: { id: carouselJobId }, include: { project: true, slides: true, approval: true } });
  const slides = job.slides.sort((a, b) => a.index - b.index);
  if (!slides.length || slides.some((s) => !s.imageUrl)) throw new ProviderError("Carousel has no rendered slides to publish", null, false);
  if (job.approval?.status !== "APPROVED") throw new ProviderError("Carousel is not approved", null, false);
  return { ...job, slides: slides as (typeof slides[number] & { imageUrl: string })[] };
}

async function publishInstagram(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const ver = v.graphVersion || "v23.0";
  if (!v.instagramUserId) throw new ProviderError("No Instagram business account is linked to the connected Facebook Page", null, false);
  const childIds: string[] = [];
  for (const slide of job.slides) {
    const imageUrl = await getStorage().signedUrl(slide.imageUrl, 3600);
    const child = await json<{ id: string }>("Instagram", `https://graph.facebook.com/${ver}/${v.instagramUserId}/media`, {
      method: "POST",
      body: new URLSearchParams({ image_url: imageUrl, is_carousel_item: "true", access_token: v.pageAccessToken ?? "" }),
    });
    childIds.push(child.id);
  }
  const container = await json<{ id: string }>("Instagram", `https://graph.facebook.com/${ver}/${v.instagramUserId}/media`, {
    method: "POST",
    body: new URLSearchParams({ media_type: "CAROUSEL", children: childIds.join(","), caption: captionFor(job, 2200), access_token: v.pageAccessToken ?? "" }),
  });
  for (let i = 0; i < 30; i++) {
    const s = await json<{ status_code?: string; status?: string }>("Instagram", `https://graph.facebook.com/${ver}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(v.pageAccessToken ?? "")}`, {});
    if (!s.status_code || s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new ProviderError(`Instagram could not process the carousel: ${s.status ?? s.status_code}`, null, false);
    if (i === 29) throw new ProviderError("Instagram carousel processing timed out", null, true);
    await sleep(5_000);
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
  const mediaIds: string[] = [];
  for (const slide of job.slides) {
    const imageUrl = await getStorage().signedUrl(slide.imageUrl, 3600);
    const photo = await json<{ id: string }>("Facebook", `https://graph.facebook.com/${ver}/${v.pageId}/photos`, {
      method: "POST",
      body: new URLSearchParams({ url: imageUrl, published: "false", temporary: "true", access_token: v.pageAccessToken ?? "" }),
    });
    mediaIds.push(photo.id);
  }
  const attachedMedia = JSON.stringify(mediaIds.map((id) => ({ media_fbid: id })));
  const post = await json<{ id: string }>("Facebook", `https://graph.facebook.com/${ver}/${v.pageId}/feed`, {
    method: "POST",
    body: new URLSearchParams({ message: captionFor(job, 5000), attached_media: attachedMedia, access_token: v.pageAccessToken ?? "" }),
  });
  return { externalId: post.id, externalUrl: `https://www.facebook.com/${post.id}` };
}

async function uploadXImage(auth: Record<string, string>, storageKey: string): Promise<string> {
  return withLocalFile(storageKey, async (file, size) => {
    const init = await json<{ data: { id: string } }>("X", "https://api.x.com/2/media/upload/initialize", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "image/png", total_bytes: size, media_category: "tweet_image" }),
    });
    const mediaId = init.data.id;
    const buf = await fs.promises.readFile(file);
    const form = new FormData();
    form.set("segment_index", "0");
    form.set("media", new Blob([buf], { type: "application/octet-stream" }), "chunk");
    const { res } = await timedFetch(`https://api.x.com/2/media/upload/${mediaId}/append`, { method: "POST", headers: auth, body: form }, 60_000);
    if (!res.ok) throw describeHttpFailure("X", res.status, await readErrorDetail(res));
    const fin = await json<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>("X", `https://api.x.com/2/media/upload/${mediaId}/finalize`, { method: "POST", headers: auth });
    let info = fin.data.processing_info;
    for (let i = 0; info && info.state !== "succeeded"; i++) {
      if (info.state === "failed") throw new ProviderError("X could not process the image", null, false);
      if (i > 20) throw new ProviderError("X image processing timed out", null, true);
      await sleep((info.check_after_secs ?? 2) * 1000);
      info = (await json<{ data: { processing_info?: { state: string; check_after_secs?: number } } }>("X", `https://api.x.com/2/media/upload?command=STATUS&media_id=${mediaId}`, { headers: auth })).data.processing_info;
    }
    return mediaId;
  });
}

async function publishX(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const auth = { Authorization: `Bearer ${v.accessToken}` };
  const slides = job.slides.slice(0, 4); // X tweets support at most 4 images
  const mediaIds: string[] = [];
  for (const slide of slides) mediaIds.push(await uploadXImage(auth, slide.imageUrl));
  const tweet = await json<{ data: { id: string } }>("X", "https://api.x.com/2/tweets", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text: captionFor(job, 280), media: { media_ids: mediaIds } }),
  });
  return { externalId: tweet.data.id, externalUrl: `https://x.com/i/web/status/${tweet.data.id}` };
}

function linkedinVersion(): string {
  if (process.env.LINKEDIN_API_VERSION) return process.env.LINKEDIN_API_VERSION;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 3);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function uploadLinkedInImage(owner: string, headers: Record<string, string>, storageKey: string): Promise<string> {
  const init = await json<{ value: { image: string; uploadUrl: string } }>("LinkedIn", "https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers,
    body: JSON.stringify({ initializeUploadRequest: { owner } }),
  });
  return withLocalFile(storageKey, async (file) => {
    const buf = await fs.promises.readFile(file);
    const { res } = await timedFetch(init.value.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: buf }, 60_000);
    if (!res.ok) throw describeHttpFailure("LinkedIn upload", res.status, await readErrorDetail(res));
    return init.value.image;
  });
}

async function publishLinkedIn(job: Job, v: Record<string, string>): Promise<PublishResult> {
  const owner = v.organizationId ? `urn:li:organization:${v.organizationId}` : `urn:li:person:${v.memberId}`;
  if (!v.organizationId && !v.memberId) throw new ProviderError("LinkedIn member id unknown — reconnect the account", null, false);
  const headers = { Authorization: `Bearer ${v.accessToken}`, "LinkedIn-Version": linkedinVersion(), "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
  const imageUrns: string[] = [];
  for (const slide of job.slides) imageUrns.push(await uploadLinkedInImage(owner, headers, slide.imageUrl));
  const { res: post } = await timedFetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      author: owner,
      commentary: captionFor(job, 2900),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { multiImage: { images: imageUrns.map((id) => ({ id })) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!post.ok) throw describeHttpFailure("LinkedIn", post.status, await readErrorDetail(post));
  const postUrn = post.headers.get("x-restli-id") ?? post.headers.get("x-linkedin-id") ?? imageUrns[0] ?? owner;
  return { externalId: postUrn, externalUrl: `https://www.linkedin.com/feed/update/${postUrn}` };
}

const PUBLISHERS: Record<string, (job: Job, creds: Record<string, string>) => Promise<PublishResult>> = {
  instagram: publishInstagram,
  facebook: publishFacebook,
  x: publishX,
  linkedin: publishLinkedIn,
};

/** `meta` backs both the instagram and facebook publish targets — mirrors publish.ts. */
const CREDS_PROVIDER: Record<string, { provider: string; label: string }> = {
  instagram: { provider: "meta", label: "Meta" },
  facebook: { provider: "meta", label: "Meta" },
  x: { provider: "x", label: "X" },
  linkedin: { provider: "linkedin", label: "LinkedIn" },
};

/**
 * Publishes an approved carousel. With no `connectedAccountId`, this uses
 * the single-account-per-provider Integration connection; with one, it
 * publishes through that specific ConnectedAccount's own tokens instead —
 * exact mirror of publishVideo's account-isolation behavior.
 */
export async function publishCarousel(carouselJobId: string, target: string, connectedAccountId?: string): Promise<PublishResult> {
  const publisher = PUBLISHERS[target];
  if (!publisher) throw new ProviderError(`Unknown publish target ${target}`, null, false);
  const legacy = CREDS_PROVIDER[target] ?? { provider: target, label: target };
  const creds = connectedAccountId ? await getConnectedAccountCreds(connectedAccountId) : await requireConnected(legacy.provider, legacy.label);
  return publisher(await loadJob(carouselJobId), creds);
}
