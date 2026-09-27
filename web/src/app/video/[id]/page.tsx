"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { VideoJob, VideoJobState } from "@/lib/types";

const STAGES: VideoJobState[] = [
  "QUEUED",
  "SCRIPT_GENERATING",
  "STORYBOARD_READY",
  "VOICE_GENERATING",
  "VISUAL_GENERATING",
  "ASSEMBLING",
  "QUALITY_CHECK",
  "READY",
];
const STAGE_LABEL: Record<string, string> = {
  QUEUED: "Queued",
  SCRIPT_GENERATING: "Script",
  STORYBOARD_READY: "Storyboard",
  VOICE_GENERATING: "Voiceover",
  VISUAL_GENERATING: "Generating visuals",
  ASSEMBLING: "Assembly",
  QUALITY_CHECK: "Quality check",
  READY: "Ready",
};

export default function VideoJobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<VideoJob | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"preview" | "script" | "storyboard" | "captions" | "metadata">("preview");
  const [sending, setSending] = useState(false);

  async function load() {
    try {
      setJob(await api.get<VideoJob>(`/api/video/jobs/${id}`));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load job");
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (job && ["READY", "FAILED", "CANCELLED"].includes(job.state)) return;
      void load();
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, job?.state]);

  async function cancel() {
    await api.post(`/api/video/jobs/${id}/cancel`);
    await load();
  }
  async function retry() {
    await api.post(`/api/video/jobs/${id}/retry`);
    await load();
  }
  async function sendToTelegram() {
    setSending(true);
    try {
      await api.post(`/api/approvals/video/${id}/send`);
      alert("Sent to Telegram for approval.");
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  if (error) return <ControlCenterLayout><ErrorState message={error} onRetry={load} /></ControlCenterLayout>;
  if (!job) return <ControlCenterLayout><LoadingState /></ControlCenterLayout>;

  const currentIndex = STAGES.indexOf(job.state);
  const failed = job.state === "FAILED";
  const cancelled = job.state === "CANCELLED";

  return (
    <ControlCenterLayout>
      <PageHeader
        title={job.project?.name ?? "Video"}
        subtitle={`${job.project?.contentType ?? ""} · ${job.project?.durationSec ?? ""}s · ${job.project?.aspectRatio ?? ""}`}
        action={<Badge tone={statusTone(job.state)}>{job.state.replace(/_/g, " ")}</Badge>}
      />

      {!failed && !cancelled ? (
        <Card className="mb-6">
          <div className="flex flex-wrap gap-4">
            {STAGES.map((stage, i) => (
              <div key={stage} className="flex items-center gap-2 text-sm">
                <span className={i < currentIndex ? "text-emerald-600" : i === currentIndex ? "text-brand-600 font-bold" : "text-slate-300"}>
                  {i < currentIndex ? "✓" : i === currentIndex ? "●" : "○"}
                </span>
                <span className={i <= currentIndex ? "text-slate-800" : "text-slate-400"}>{STAGE_LABEL[stage]}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="mb-6 border-red-200 bg-red-50">
          <p className="font-semibold text-red-800">{failed ? `Failed at ${job.errorStage ?? "unknown stage"}` : "Cancelled"}</p>
          {job.error ? <p className="mt-1 text-sm text-red-700">{job.error}</p> : null}
        </Card>
      )}

      <div className="mb-4 flex gap-2">
        {!failed && !cancelled && job.state !== "READY" ? <Button variant="danger" onClick={cancel}>Cancel</Button> : null}
        {failed ? <Button onClick={retry}>Retry</Button> : null}
        {job.state === "READY" ? (
          <Button onClick={sendToTelegram} disabled={sending}>
            {sending ? "Sending..." : "Send to Telegram"}
          </Button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(["preview", "script", "storyboard", "captions", "metadata"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-semibold capitalize ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "preview" ? (
        job.finalVideoUrl ? (
          <video controls className="max-w-md rounded-xl border border-slate-200" src={job.finalVideoUrl} />
        ) : (
          <p className="text-sm text-slate-400">No preview yet — the final video is not ready.</p>
        )
      ) : null}

      {tab === "script" ? (
        <pre className="max-w-2xl overflow-auto rounded-xl bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(job.script, null, 2)}</pre>
      ) : null}

      {tab === "storyboard" ? (
        <div className="space-y-2">
          {job.scenes.map((scene) => (
            <Card key={scene.id}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">Scene {scene.index + 1}</p>
                <Badge tone={statusTone(scene.status)}>{scene.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">{scene.visualPrompt}</p>
              {scene.error ? <p className="mt-1 text-xs text-red-600">{scene.error}</p> : null}
            </Card>
          ))}
        </div>
      ) : null}

      {tab === "captions" ? (
        <Card className="max-w-xl">
          <p className="text-sm font-semibold">Caption</p>
          <p className="mt-1 text-sm text-slate-700">{job.caption}</p>
          <p className="mt-4 text-sm font-semibold">Hashtags</p>
          <p className="mt-1 text-sm text-slate-700">{job.hashtags.join(" ")}</p>
        </Card>
      ) : null}

      {tab === "metadata" ? (
        <Card className="max-w-xl text-sm text-slate-700">
          <p>Retry count: {job.retryCount}</p>
          <p>Created: {new Date(job.createdAt).toLocaleString()}</p>
          <p>Completed: {job.completedAt ? new Date(job.completedAt).toLocaleString() : "—"}</p>
          <p>Assets: {job.assets.map((a) => a.type).join(", ") || "none"}</p>
          {job.approval ? <p>Approval: {job.approval.status}</p> : <p>Approval: not sent</p>}
        </Card>
      ) : null}
    </ControlCenterLayout>
  );
}
