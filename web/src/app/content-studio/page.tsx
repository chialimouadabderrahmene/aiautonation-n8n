"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { VideoProject } from "@/lib/types";

/**
 * The central content workspace (spec §24): one project = brief, script,
 * storyboard, voice, video, captions, approval, publishing state, all in one
 * place. Reuses VideoProject/VideoJob — a project IS the content pipeline
 * unit; this view just frames it that way instead of "video job details".
 */
export default function ContentStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setProjects(await api.get<VideoProject[]>("/api/video/projects"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader
        title="AI Content Studio"
        subtitle="Every content project and where it stands: brief → script → storyboard → voice → video → subtitles → approval → publish."
        action={
          <Link href="/video" className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            New content
          </Link>
        }
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : projects.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No content projects yet. Create one from <Link href="/video" className="font-semibold text-brand-600">Video Generator</Link>.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => {
            const job = p.jobs?.[0];
            const steps: { label: string; done: boolean }[] = [
              { label: "Script", done: !!job && job.state !== "QUEUED" },
              { label: "Voice", done: !!job && !["QUEUED", "SCRIPT_GENERATING", "STORYBOARD_READY"].includes(job.state) },
              { label: "Video", done: !!job && ["ASSEMBLING", "QUALITY_CHECK", "READY"].includes(job.state) },
              { label: "Subtitles", done: p.subtitles && !!job && ["QUALITY_CHECK", "READY"].includes(job.state) },
              { label: "Ready", done: job?.state === "READY" },
              { label: "Approved", done: job?.approval?.status === "APPROVED" },
            ];
            return (
              <Link key={p.id} href={job ? `/video/${job.id}` : "#"}>
                <Card className="hover:border-brand-500">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">{p.name}</p>
                      <p className="text-sm text-slate-500">{p.topic}</p>
                    </div>
                    <div className="flex gap-2">
                      {job?.approval ? <Badge tone={statusTone(job.approval.status)}>{job.approval.status}</Badge> : null}
                      {job ? <Badge tone={statusTone(job.state)}>{job.state.replace(/_/g, " ")}</Badge> : <Badge tone="slate">No job</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {steps.map((s) => (
                      <span key={s.label} className={s.done ? "text-emerald-600" : "text-slate-400"}>
                        {s.done ? "✓" : "○"} {s.label}
                      </span>
                    ))}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </ControlCenterLayout>
  );
}
