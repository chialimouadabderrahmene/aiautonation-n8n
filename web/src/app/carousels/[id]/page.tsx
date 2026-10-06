"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, inputClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

interface Slide {
  id: string;
  index: number;
  headline: string;
  body: string | null;
  imageUrl: string | null;
}

interface Publication {
  id: string;
  target: string;
  status: string;
  externalUrl: string | null;
  error: string | null;
}

interface Approval {
  status: string;
  note: string | null;
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

interface CarouselJobDetail {
  id: string;
  state: string;
  error: string | null;
  progress: number;
  caption: string | null;
  hashtags: string[];
  slides: Slide[];
  approval: Approval | null;
  publications: Publication[];
  project: { name: string; topic: string; platform: string; slideCount: number; publishTargets: string[] };
}

const ACTIVE_CAROUSEL_STATES = ["QUEUED", "SCRIPT_GENERATING", "RENDERING", "QUALITY_CHECK"];

function SlideThumb({ slide }: { slide: Slide }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slide.imageUrl) return;
    api.get<{ url: string }>(`/api/carousel/slides/${slide.id}/url`).then((r) => setUrl(r.url)).catch(() => undefined);
  }, [slide.id, slide.imageUrl]);
  return (
    <div className="w-32">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={slide.headline} className="h-40 w-32 rounded border border-slate-200 object-cover" />
      ) : (
        <div className="flex h-40 w-32 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs text-slate-400">#{slide.index + 1}</div>
      )}
      <p className="mt-1 text-xs font-semibold text-slate-700">{slide.headline}</p>
    </div>
  );
}

export default function CarouselJobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<CarouselJobDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      setJob(await api.get<CarouselJobDetail>(`/api/carousel/jobs/${id}`));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const active = Boolean(job && (ACTIVE_CAROUSEL_STATES.includes(job.state) || job.publications.some((p) => p.status === "PENDING" || p.status === "PUBLISHING")));
  usePolling(load, 3000, active);

  async function act(label: string, path: string, body?: unknown) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await api.post<{ message?: string }>(path, body);
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

  const approval = job.approval;
  const isReady = job.state === "READY";

  return (
    <ControlCenterLayout>
      <PageHeader title={job.project.name} subtitle={`${job.project.topic} · ${job.project.platform} · ${job.project.slideCount} slides`} action={<StatusBadge status={job.state} />} />
      <Link href="/carousels" className="mb-4 inline-block text-sm font-semibold text-brand-600">
        ← All carousels
      </Link>

      {job.error ? (
        <Card className="mb-6">
          <Notice tone={job.state === "FAILED" ? "red" : "amber"}>{job.error}</Notice>
          {job.state === "FAILED" ? (
            <div className="mt-3">
              <Button onClick={() => void act("retry", `/api/carousel/jobs/${job.id}/retry`)} disabled={Boolean(busy)}>
                {busy === "retry" ? "Queuing…" : "Retry"}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {msg ? (
        <div className="mb-6">
          <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice>
        </div>
      ) : null}

      {job.slides.length ? (
        <Card className="mb-6">
          <p className="font-bold text-slate-900">Slides</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {job.slides.map((s) => (
              <SlideThumb key={s.id} slide={s} />
            ))}
          </div>
          {job.caption ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase text-slate-400">Caption</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{job.caption}</p>
              <p className="mt-1 text-xs text-slate-500">{job.hashtags.join(" ")}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {isReady ? (
        <Card>
          <p className="font-bold text-slate-900">Approval</p>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge status={approval?.status ?? "PENDING"} />
          </div>
          {approval?.rejectionReason ? <p className="mt-1 text-xs text-red-700">{approval.rejectionReason}</p> : null}

          {!approval || approval.status === "PENDING" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => void act("approve", `/api/carousel/jobs/${job.id}/decision`, { decision: "APPROVED" })} disabled={Boolean(busy)}>
                Approve here
              </Button>
              <Button variant="danger" onClick={() => void act("reject", `/api/carousel/jobs/${job.id}/decision`, { decision: "REJECTED", reason: note || undefined })} disabled={Boolean(busy)}>
                Reject
              </Button>
            </div>
          ) : null}

          {approval?.status === "REJECTED" ? (
            <div className="mt-4">
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Rejection reason" />
            </div>
          ) : null}

          <p className="mt-6 font-bold text-slate-900">Publishing</p>
          {job.project.publishTargets.length ? (
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
                        <Button variant="secondary" onClick={() => void act(`pub-${t}`, `/api/carousel/jobs/${job.id}/publish/${t}/retry`)} disabled={Boolean(busy)}>
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
            <p className="mt-1 text-xs text-slate-500">No automatic publishing selected for this project.</p>
          )}
        </Card>
      ) : null}
    </ControlCenterLayout>
  );
}
