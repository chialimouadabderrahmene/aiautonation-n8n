"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, APIError } from "@/lib/api";
import { Piece, PieceKind, TARGET_LABEL, useHome } from "@/lib/home";
import { Banner, Btn, KIND_LABEL, Phone, PiecePreview } from "./kit";

interface Publication { id: string; target: string; status: string; externalUrl: string | null; error: string | null; scheduledFor: string | null }
interface Scene { index: number; voiceoverText: string | null; subtitleText: string | null }
interface Slide { id: string; index: number; headline: string; body: string | null }
interface Detail {
  id: string;
  state: string;
  progress: number;
  error: string | null;
  errorStage?: string | null;
  caption: string | null;
  hashtags: string[];
  approval: { status: string; rejectionReason: string | null } | null;
  publications: Publication[];
  project: { id: string; name: string; testMode: boolean; publishTargets: string[] };
  finalVideo?: { playUrl: string | null; downloadUrl: string | null } | null;
  scenes?: Scene[];
  slides?: Slide[];
}

const VIDEO_STEPS = [
  { states: ["QUEUED"], label: "In the queue" },
  { states: ["SCRIPT_GENERATING", "STORYBOARD_READY"], label: "Writing the script" },
  { states: ["VOICE_GENERATING"], label: "Recording the voice" },
  { states: ["VISUAL_GENERATING"], label: "Filming the scenes" },
  { states: ["ASSEMBLING"], label: "Editing it together" },
  { states: ["QUALITY_CHECK"], label: "Checking quality" },
];
const CAROUSEL_STEPS = [
  { states: ["QUEUED"], label: "In the queue" },
  { states: ["SCRIPT_GENERATING"], label: "Writing the slides" },
  { states: ["RENDERING"], label: "Designing the slides" },
  { states: ["QUALITY_CHECK"], label: "Checking quality" },
];

function Progress({ detail, kind }: { detail: Detail; kind: "video" | "carousel" }) {
  const steps = kind === "video" ? VIDEO_STEPS : CAROUSEL_STEPS;
  const current = steps.findIndex((s) => s.states.includes(detail.state));
  return (
    <div>
      <h2 className="text-3xl font-bold">Eki is making this.</h2>
      <p className="mt-1 text-ink-soft">You can close this page. It keeps going and will wait for you in Review.</p>
      <ol className="mt-6 space-y-3">
        {steps.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.label} className={`flex items-center gap-3 text-base ${now ? "font-semibold" : done ? "text-ink-soft" : "text-ink-faint"}`}>
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-leaf text-white" : now ? "pulse-dot bg-palm text-white" : "bg-slate-200 text-ink-faint"}`}>{done ? "✓" : i + 1}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-palm transition-all duration-700" style={{ width: `${Math.max(4, detail.progress)}%` }} />
      </div>
    </div>
  );
}

function Carousel({ slides }: { slides: Slide[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  useEffect(() => {
    slides.forEach((s) => void api.get<{ url: string }>(`/api/carousel/slides/${s.id}/url`).then((r) => setUrls((u) => ({ ...u, [s.id]: r.url }))).catch(() => undefined));
    // Signed links only need fetching once per set of slides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);
  const slide = slides[i];
  if (!slide) return null;
  return (
    <div className="absolute inset-0 flex flex-col bg-slate-900">
      <div className="flex flex-1 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {urls[slide.id] ? <img src={urls[slide.id]} alt={slide.headline} className="w-full" /> : <div className="h-full w-full animate-pulse bg-slate-800" />}
      </div>
      <div className="flex items-center justify-between bg-ink px-3 py-2 text-paper">
        <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} aria-label="Previous slide" className="px-3 text-xl disabled:opacity-30">‹</button>
        <span className="text-xs">{i + 1} of {slides.length}</span>
        <button onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))} disabled={i === slides.length - 1} aria-label="Next slide" className="px-3 text-xl disabled:opacity-30">›</button>
      </div>
    </div>
  );
}

function localDefault(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function Destinations({ detail }: { detail: Detail }) {
  const practice = detail.project.testMode;
  const word = (p: Publication) => {
    if (p.status === "PUBLISHED") return practice ? "Would have posted" : "Posted";
    if (p.status === "SCHEDULED") return p.scheduledFor ? `Scheduled for ${new Date(p.scheduledFor).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : "Scheduled";
    if (p.status === "FAILED") return "Did not post";
    if (p.status === "SKIPPED") return "Post this one yourself";
    return "Posting now";
  };
  return (
    <ul className="mt-4 divide-y divide-dashed divide-rule rounded-2xl bg-card px-4 shadow-ticket">
      {detail.publications.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="font-semibold">{TARGET_LABEL[p.target] ?? p.target}</span>
          <span className={`text-sm ${p.status === "PUBLISHED" ? "text-leaf" : p.status === "FAILED" ? "text-berry" : "text-ink-soft"}`}>
            {p.externalUrl ? <a href={p.externalUrl} target="_blank" rel="noreferrer" className="underline">{word(p)}</a> : word(p)}
          </span>
          {p.error ? <span className="w-full text-xs text-berry">{p.error}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function MediaDesk({ kind, id }: { kind: "video" | "carousel"; id: string }) {
  const router = useRouter();
  const { data, refresh } = useHome();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [caption, setCaption] = useState("");
  const [captionDirty, setCaptionDirty] = useState(false);
  const [panel, setPanel] = useState<"" | "changes" | "schedule">("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(localDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = kind === "video" ? "/api/video" : "/api/carousel";

  const load = useCallback(async () => {
    try {
      const d = await api.get<Detail>(`${base}/jobs/${id}`);
      setDetail(d);
      setCaptionDirty((dirty) => {
        if (!dirty) setCaption(d.caption ?? "");
        return dirty;
      });
    } catch (err) {
      if (err instanceof APIError && err.status === 404) setNotFound(true);
    }
  }, [base, id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);

  const nextInQueue = () => data?.line.review.find((p) => p.id !== id);

  async function saveCaption() {
    if (captionDirty && caption.trim()) {
      await api.put(`${base}/jobs/${id}/caption`, { caption: caption.trim() });
      setCaptionDirty(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const decide = (decision: "APPROVED" | "REJECTED", reason?: string) =>
    api.post(kind === "video" ? `/api/approvals/video/${id}/decision` : `/api/carousel/jobs/${id}/decision`, { decision, reason });

  const approve = () =>
    run(async () => {
      await saveCaption();
      await decide("APPROVED");
    });

  const schedule = () =>
    run(async () => {
      await saveCaption();
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      // Schedule first: approving publishes every destination that does not already have a timer.
      await api.post(`${base}/jobs/${id}/schedule`, { scheduledFor: new Date(when).toISOString(), timezone: zone });
      await decide("APPROVED");
      setPanel("");
    });

  const askForChanges = () =>
    run(async () => {
      await decide("REJECTED", note.trim() || "Changes requested");
      const r = await api.post<{ job: { id: string } }>(`${base}/projects/${detail!.project.id}/regenerate`, { note: note.trim() || undefined });
      router.push(`/review/${kind}/${r.job.id}`);
    });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (detail?.state !== "READY" || detail.approval?.status === "APPROVED" || detail.approval?.status === "REJECTED") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "TEXTAREA" || t.tagName === "INPUT") return;
      if (e.key.toLowerCase() === "a") void approve();
      if (e.key.toLowerCase() === "r") setPanel("changes");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.state, detail?.approval?.status, caption, captionDirty]);

  if (notFound) return <Banner>This piece no longer exists. <Link href="/review" className="underline">Back to Review</Link></Banner>;
  if (!detail) return <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />;

  const failed = detail.state === "FAILED" || detail.state === "CANCELLED";
  const ready = detail.state === "READY";
  const decided = detail.approval?.status === "APPROVED" || detail.approval?.status === "REJECTED";
  const approved = detail.approval?.status === "APPROVED";
  const posting = detail.publications.some((p) => p.status === "PENDING" || p.status === "SCHEDULED");
  const next = nextInQueue();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div>
        <Phone>
          {kind === "video" && detail.finalVideo?.playUrl ? (
            <video src={detail.finalVideo.playUrl} controls playsInline className="absolute inset-0 h-full w-full object-cover" />
          ) : kind === "carousel" && ready && detail.slides?.length ? (
            <Carousel slides={detail.slides} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-palm via-plantain to-ink p-6 text-center">
              <p className="font-display text-xl font-bold text-white">{failed ? "Stopped" : `${detail.progress}%`}</p>
            </div>
          )}
        </Phone>
        {detail.finalVideo?.downloadUrl ? (
          <p className="mt-3 text-center text-sm"><a href={detail.finalVideo.downloadUrl} className="font-semibold underline underline-offset-2">Download the video</a></p>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-palm">{KIND_LABEL[kind]}{detail.project.testMode ? " · sample" : ""}</p>
        <p className="mb-5 mt-1 text-sm text-ink-faint">{detail.project.name}</p>

        {error ? <div className="mb-4"><Banner tone="berry">{error}</Banner></div> : null}

        {!ready && !failed ? <Progress detail={detail} kind={kind} /> : null}

        {failed ? (
          <div>
            <h2 className="text-3xl font-bold">This one stopped.</h2>
            <p className="mt-2 text-ink-soft">{detail.errorStage ? `It got as far as ${detail.errorStage.replace(/_/g, " ").toLowerCase()}. ` : ""}Nothing went out.</p>
            {detail.error ? <div className="mt-4"><Banner tone="berry">{detail.error}</Banner></div> : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <Btn big disabled={busy} onClick={() => void run(async () => { await api.post(`${base}/jobs/${id}/retry`); })}>Try again</Btn>
              <Btn big tone="ghost" href="/setup">Check connections</Btn>
            </div>
          </div>
        ) : null}

        {ready && !decided ? (
          <div>
            <h2 className="text-4xl font-bold">Is this good to go?</h2>
            <label htmlFor="caption" className="mt-6 block text-sm font-semibold">Caption</label>
            <textarea
              id="caption" value={caption} rows={4} maxLength={2200}
              onChange={(e) => { setCaption(e.target.value); setCaptionDirty(true); }}
              className="mt-1 w-full rounded-2xl border border-rule bg-card px-4 py-3 outline-none focus:border-ink"
            />
            {detail.hashtags?.length ? <p className="mt-1 text-sm text-ink-faint">{detail.hashtags.join(" ")}</p> : null}
            <p className="mt-3 text-sm text-ink-soft">
              {detail.project.publishTargets.length
                ? <>Goes to <strong>{detail.project.publishTargets.map((t) => TARGET_LABEL[t] ?? t).join(", ")}</strong>{detail.project.testMode ? " (pretend, because you are practising)" : ""}.</>
                : "No accounts picked, so after approving you can download it and post it yourself."}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Btn big tone="leaf" disabled={busy} onClick={() => void approve()}>Approve and post</Btn>
              {detail.project.publishTargets.length ? <Btn big tone="ghost" disabled={busy} onClick={() => setPanel(panel === "schedule" ? "" : "schedule")}>Post later</Btn> : null}
              <Btn big tone="ghost" disabled={busy} onClick={() => setPanel(panel === "changes" ? "" : "changes")}>Ask for changes</Btn>
              <span className="hidden text-xs text-ink-faint lg:inline">Press A to approve, R for changes</span>
            </div>

            {panel === "schedule" ? (
              <div className="rise mt-4 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-100 p-4">
                <div>
                  <label htmlFor="when" className="mb-1 block text-sm font-semibold">When?</label>
                  <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded-xl border border-rule bg-card px-3 py-2 outline-none focus:border-ink" />
                </div>
                <Btn tone="leaf" disabled={busy || !when} onClick={() => void schedule()}>Approve and schedule</Btn>
              </div>
            ) : null}
            {panel === "changes" ? (
              <div className="rise mt-4 rounded-2xl bg-slate-100 p-4">
                <label htmlFor="note" className="mb-1 block text-sm font-semibold">What should change?</label>
                <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} autoFocus placeholder="For example: make it about vendors, and shorter" className="w-full rounded-xl border border-rule bg-card px-3 py-2 outline-none focus:border-ink" />
                <div className="mt-2"><Btn tone="ink" disabled={busy} onClick={() => void askForChanges()}>Remake it with these changes</Btn></div>
              </div>
            ) : null}

            {detail.scenes?.length ? (
              <details className="mt-6 rounded-2xl bg-slate-100 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Read the script</summary>
                <ol className="mt-3 space-y-2 text-ink-soft">
                  {detail.scenes.map((s) => <li key={s.index}>{s.index + 1}. {s.voiceoverText ?? s.subtitleText}</li>)}
                </ol>
              </details>
            ) : null}
            {detail.slides?.length ? (
              <details className="mt-6 rounded-2xl bg-slate-100 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">Read the slides</summary>
                <ol className="mt-3 space-y-2 text-ink-soft">
                  {detail.slides.map((s) => <li key={s.id}><strong>{s.headline}</strong>{s.body ? `. ${s.body}` : ""}</li>)}
                </ol>
              </details>
            ) : null}
          </div>
        ) : null}

        {ready && approved ? (
          <div>
            <h2 className="text-4xl font-bold">{posting ? "Going out." : detail.publications.length ? "Done." : "Approved."}</h2>
            <p className="mt-2 text-ink-soft">
              {detail.project.testMode ? "This is practice, so nothing was really posted. In live mode it would be on your accounts now." : posting ? "Eki is posting it for you." : detail.publications.length ? "It is out in the world." : "Download it and post it yourself."}
            </p>
            {detail.publications.length ? <Destinations detail={detail} /> : null}
            {detail.publications.some((p) => p.status === "SCHEDULED") ? (
              <div className="mt-4"><Btn tone="ghost" disabled={busy} onClick={() => void run(async () => { await api.post(`${base}/jobs/${id}/schedule/cancel`); })}>Cancel schedule</Btn></div>
            ) : null}
          </div>
        ) : null}

        {ready && detail.approval?.status === "REJECTED" ? (
          <div>
            <h2 className="text-4xl font-bold">Sent back.</h2>
            {detail.approval.rejectionReason ? <p className="mt-2 text-ink-soft">You asked: {detail.approval.rejectionReason}</p> : null}
            <div className="mt-5"><Btn big disabled={busy} onClick={() => void run(async () => {
              const r = await api.post<{ job: { id: string } }>(`${base}/projects/${detail.project.id}/regenerate`, {});
              router.push(`/review/${kind}/${r.job.id}`);
            })}>Make it again</Btn></div>
          </div>
        ) : null}

        {decided && next ? (
          <div className="mt-8 border-t border-dashed border-rule pt-5">
            <Btn big href={`/review/${next.kind}/${next.id}`}>Next to review →</Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PostDesk({ id }: { id: string }) {
  const { data, refresh } = useHome();
  const next = data?.line.review.find((p) => p.id !== id);
  const [piece, setPiece] = useState<Piece | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const all = await api.get<Piece[]>("/api/home/pieces");
    setPiece(all.find((p) => p.kind === "post" && p.id === id) ?? null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/engine/content-drafts/${id}/${path}`, body);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (piece === undefined) return <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  if (piece === null) return <Banner>This post no longer exists. <Link href="/review" className="underline">Back to Review</Link></Banner>;
  const target = piece.destinations[0]?.target;

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-wider text-palm">Post{piece.practice ? " · sample" : ""}{target ? ` for ${TARGET_LABEL[target] ?? target}` : ""}</p>
      <blockquote className="mt-3 rounded-3xl bg-card p-6 text-xl leading-snug shadow-ticket">{piece.caption}</blockquote>
      {error ? <div className="mt-4"><Banner tone="berry">{error}</Banner></div> : null}
      {piece.station === "review" ? (
        <div className="mt-6">
          <div className="flex flex-wrap gap-3">
            <Btn big tone="leaf" disabled={busy} onClick={() => void act("approve")}>Approve</Btn>
            <Btn big tone="ghost" disabled={busy} onClick={() => setRejecting((v) => !v)}>Not this one</Btn>
          </div>
          <p className="mt-3 text-sm text-ink-faint">Approved posts go out at the next slot when the Post what you approved autopilot is on.</p>
          {rejecting ? (
            <div className="rise mt-4 rounded-2xl bg-slate-100 p-4">
              <label htmlFor="note" className="mb-1 block text-sm font-semibold">Why not? (optional)</label>
              <input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="w-full rounded-xl border border-rule bg-card px-3 py-2 outline-none focus:border-ink" />
              <div className="mt-2"><Btn tone="ink" disabled={busy} onClick={() => void act("reject", { note })}>Reject it</Btn></div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mt-6 font-display text-2xl font-bold">{piece.station === "stopped" ? "Rejected." : piece.station === "posted" ? "Posted." : "Approved. It goes out at the next slot."}</p>
          {next ? <div className="mt-5"><Btn big href={`/review/${next.kind}/${next.id}`}>Next to review →</Btn></div> : null}
        </>
      )}
    </div>
  );
}

export function Desk({ kind, id }: { kind: PieceKind; id: string }) {
  if (kind === "post") return <PostDesk id={id} />;
  return <MediaDesk kind={kind} id={id} />;
}

/** The side list of what else is waiting. */
export function QueueRail({ currentId }: { currentId?: string }) {
  const { data } = useHome();
  const items = data?.line.review ?? [];
  if (!items.length) return null;
  return (
    <div className="mb-8 flex gap-3 overflow-x-auto pb-2" aria-label="Waiting for you">
      {items.map((p) => (
        <Link key={p.id} href={`/review/${p.kind}/${p.id}`} className={`flex w-56 shrink-0 items-center gap-3 rounded-2xl border-2 p-2 transition ${p.id === currentId ? "border-ink bg-card" : "border-transparent bg-slate-100 hover:border-rule"}`}>
          <PiecePreview piece={p} className="h-12 w-9 shrink-0 rounded" />
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-palm">{KIND_LABEL[p.kind]}</span>
            <span className="line-clamp-2 text-xs font-semibold leading-tight">{p.title}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
