"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, formatBytes, formatDateTime, inputClass, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ACTIVE_VIDEO_STATES, VideoJob, VideoJobState } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const STAGES: { state: VideoJobState; label: string }[] = [
  { state: "QUEUED", label: "Queued" },
  { state: "SCRIPT_GENERATING", label: "Script" },
  { state: "STORYBOARD_READY", label: "Storyboard" },
  { state: "VOICE_GENERATING", label: "Voice" },
  { state: "VISUAL_GENERATING", label: "Visuals" },
  { state: "ASSEMBLING", label: "Assembly" },
  { state: "QUALITY_CHECK", label: "Quality check" },
  { state: "READY", label: "Ready" },
];

export default function VideoJobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<VideoJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      setJob(await api.get<VideoJob>(`/api/video/jobs/${id}`));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const active = Boolean(job && (ACTIVE_VIDEO_STATES.includes(job.state) || job.publications.some((p) => p.status === "PENDING" || p.status === "PUBLISHING") || job.approval?.note === "Sending to Telegram…"));
  usePolling(load, 3000, active);

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await api.post<{ message?: string; job?: { id: string } }>(path, body);
      if (r?.job?.id) {
        router.push(`/video/${r.job.id}`);
        return;
      }
      if (r?.message) setMsg({ ok: true, text: r.message });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally {
      setBusy("");
      await load();
    }
  }

  if (error) {
    return (
      <ControlCenterLayout>
        <ErrorState message={error} onRetry={load} />
      </ControlCenterLayout>
    );
  }
  if (!job) {
    return (
      <ControlCenterLayout>
        <LoadingState />
      </ControlCenterLayout>
    );
  }

  // While an automatic retry is pending the job is QUEUED again, but the
  // stages before the failed one are finished (and will not be re-run).
  const retryPending = job.state === "QUEUED" && Boolean(job.errorStage);
  const stageIndex = retryPending ? STAGES.findIndex((s) => s.state === job.errorStage) : STAGES.findIndex((s) => s.state === job.state);
  const failedAt = job.errorStage ? STAGES.findIndex((s) => s.state === job.errorStage) : -1;
  const final = job.finalVideo;
  const isReady = job.state === "READY";
  const approval = job.approval;

  return (
    <ControlCenterLayout>
      <PageHeader
        title={job.project?.name ?? "Video"}
        subtitle={`${job.project?.contentType} · ${job.project?.durationSec}s · ${job.project?.aspectRatio} · created ${formatDateTime(job.createdAt)}`}
        action={<StatusBadge status={job.state} />}
      />
      <Link href="/video" className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← All videos
      </Link>

      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s, i) => {
            const done = job.state === "READY" || (stageIndex > i && job.state !== "FAILED" && job.state !== "CANCELLED") || (job.state === "FAILED" && failedAt > i);
            const current = retryPending ? i === stageIndex : s.state === job.state || (job.state === "FAILED" && failedAt === i);
            return (
              <span
                key={s.state}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  current && job.state === "FAILED" ? "bg-red-100 text-red-700" : current ? "bg-blue-100 text-blue-700" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                }`}
              >
                {done ? "✓ " : current ? (job.state === "FAILED" ? "✕ " : retryPending ? "↻ " : "● ") : ""}
                {s.label}
                {current && retryPending ? " (retrying)" : ""}
              </span>
            );
          })}
        </div>
        {ACTIVE_VIDEO_STATES.includes(job.state) ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${job.progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{job.progress}% — updates live. Generation continues if you close this page.</p>
          </div>
        ) : null}
        {job.error ? (
          <div className="mt-4">
            <Notice tone={job.state === "FAILED" ? "red" : "amber"}>
              {job.errorStage ? <span className="font-semibold">{job.errorStage.replace(/_/g, " ")}: </span> : null}
              {job.error}
            </Notice>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {ACTIVE_VIDEO_STATES.includes(job.state) ? (
            <Button variant="danger" onClick={() => void act("cancel", `/api/video/jobs/${job.id}/cancel`)} disabled={Boolean(busy)}>
              Cancel
            </Button>
          ) : null}
          {job.state === "FAILED" || job.state === "CANCELLED" ? (
            <Button onClick={() => void act("retry", `/api/video/jobs/${job.id}/retry`)} disabled={Boolean(busy)}>
              {busy === "retry" ? "Queuing…" : "Retry (resumes from the failed step)"}
            </Button>
          ) : null}
          <span className="self-center text-xs text-slate-400">{job.retryCount ? `Retried ${job.retryCount}×` : ""}</span>
        </div>
      </Card>

      {msg ? (
        <div className="mb-6">
          <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice>
        </div>
      ) : null}

      {isReady && final ? (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            {final.playUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={final.playUrl} controls playsInline className="max-h-[70vh] w-full rounded-xl bg-black" />
            ) : (
              <p className="text-sm text-slate-500">Storage link unavailable.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {final.width}×{final.height} · {final.durationSec?.toFixed(1)} s · {formatBytes(final.sizeBytes)} · H.264/AAC MP4
            </p>
            {final.downloadUrl ? (
              <a href={final.downloadUrl} className="mt-2 inline-block text-sm font-semibold text-brand-600 underline">
                Download MP4
              </a>
            ) : null}
          </Card>
          <Card>
            <p className="font-bold text-slate-900">Approval</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={approval?.status ?? "PENDING"} />
              {approval?.decidedBy ? (
                <span className="text-xs text-slate-500">
                  by {approval.decidedBy} {timeAgo(approval.decidedAt)}
                </span>
              ) : null}
            </div>
            {approval?.note ? <p className="mt-2 text-xs text-slate-500">{approval.note}</p> : null}
            {approval?.rejectionReason ? <p className="mt-1 text-xs text-red-700">{approval.rejectionReason}</p> : null}

            {!approval || approval.status === "PENDING" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void act("send", `/api/approvals/video/${job.id}/send`)} disabled={Boolean(busy)}>
                  {busy === "send" ? "Queuing…" : approval ? "Resend to Telegram" : "Send to Telegram"}
                </Button>
                <Button onClick={() => void act("approve", `/api/approvals/video/${job.id}/decision`, { decision: "APPROVED" })} disabled={Boolean(busy)}>
                  Approve here
                </Button>
                <Button variant="danger" onClick={() => void act("reject", `/api/approvals/video/${job.id}/decision`, { decision: "REJECTED", reason: note || undefined })} disabled={Boolean(busy)}>
                  Reject
                </Button>
              </div>
            ) : null}

            {approval?.status === "REJECTED" ? (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-700">Regenerate with changes</p>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="What should change? (added to the brief)" />
                <div className="mt-2">
                  <Button onClick={() => void act("regenerate", `/api/video/projects/${job.projectId}/regenerate`, { note: note || undefined })} disabled={Boolean(busy)}>
                    {busy === "regenerate" ? "Queuing…" : "Regenerate video"}
                  </Button>
                </div>
              </div>
            ) : null}

            <p className="mt-6 font-bold text-slate-900">Publishing</p>
            {job.project?.publishTargets.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {job.project.publishTargets.map((t) => {
                  const p = job.publications.find((x) => x.target === t);
                  return (
                    <li key={t} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="capitalize text-slate-700">{t}</span>
                      <span className="flex items-center gap-2">
                        {p?.externalUrl ? (
                          <a href={p.externalUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-600 underline">
                            View post
                          </a>
                        ) : null}
                        <StatusBadge status={p?.status ?? (approval?.status === "APPROVED" ? "PENDING" : "WAITING_APPROVAL")} />
                        {p?.status === "FAILED" || p?.status === "SKIPPED" ? (
                          <Button variant="secondary" onClick={() => void act(`pub-${t}`, `/api/approvals/video/${job.id}/publish/${t}/retry`)} disabled={Boolean(busy)}>
                            Retry
                          </Button>
                        ) : null}
                      </span>
                      {p?.error ? <span className="w-full text-xs text-red-700">{p.error}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No automatic publishing selected — download the MP4 and post it manually once approved.</p>
            )}
            {job.caption ? (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase text-slate-400">Caption</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{job.caption}</p>
                <p className="mt-1 text-xs text-slate-500">{job.hashtags.join(" ")}</p>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {job.scenes.length ? (
        <Card>
          <p className="font-bold text-slate-900">Storyboard ({job.scenes.length} scenes)</p>
          <div className="mt-4 space-y-4">
            {job.scenes.map((s) => (
              <div key={s.id} className="grid grid-cols-1 gap-3 border-b border-slate-100 pb-4 md:grid-cols-[160px_1fr]">
                <div>
                  {s.previewUrl ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video src={s.previewUrl} muted loop playsInline controls className="w-full rounded-lg bg-black" />
                  ) : (
                    <div className="flex h-24 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">{s.status === "GENERATING" ? "Generating…" : "No clip yet"}</div>
                  )}
                </div>
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Scene {s.index + 1}</span>
                    <StatusBadge status={s.status === "READY" ? "READY" : s.status === "FAILED" ? "FAILED" : s.status} />
                    <span className="text-xs text-slate-400">
                      {s.durationSec}s clip{s.voiceDurationSec ? ` · voice ${s.voiceDurationSec.toFixed(1)}s` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-700">🎙 {s.voiceoverText}</p>
                  <p className="mt-1 text-xs text-slate-500">🎬 {s.visualPrompt}</p>
                  {s.error ? <p className="mt-1 text-xs text-red-700">{s.error}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </ControlCenterLayout>
  );
}
