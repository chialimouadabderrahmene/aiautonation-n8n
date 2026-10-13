"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ConnectedAccount, Integration } from "@/lib/types";

const TARGETS = [
  { value: "instagram", label: "Instagram carousel", provider: "meta" },
  { value: "facebook", label: "Facebook album", provider: "meta" },
  { value: "x", label: "X", provider: "x" },
  { value: "linkedin", label: "LinkedIn", provider: "linkedin" },
];

interface Slide {
  id: string;
  index: number;
  headline: string;
  body: string | null;
  imageUrl: string | null;
}

interface CarouselPublication {
  id: string;
  target: string;
  status: string;
}

interface CarouselJob {
  id: string;
  state: string;
  error: string | null;
  progress: number;
  slides: Slide[];
  approval: { status: string } | null;
  publications: CarouselPublication[];
}

interface CarouselProject {
  id: string;
  name: string;
  topic: string;
  platform: string;
  slideCount: number;
  publishTargets: string[];
  createdAt: string;
  jobs: CarouselJob[];
}

function SlideThumb({ slide }: { slide: Slide }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slide.imageUrl) return;
    api.get<{ url: string }>(`/api/carousel/slides/${slide.id}/url`).then((r) => setUrl(r.url)).catch(() => undefined);
  }, [slide.id, slide.imageUrl]);
  if (!url) return <div className="flex h-24 w-20 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs text-slate-400">#{slide.index + 1}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={slide.headline} className="h-24 w-20 rounded border border-slate-200 object-cover" />;
}

function CreateForm({ connected, connectedAccounts, onCreated }: { connected: Set<string>; connectedAccounts: ConnectedAccount[]; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [slideCount, setSlideCount] = useState(6);
  const [publishTargets, setPublishTargets] = useState<string[]>([]);
  const [publishAccountIds, setPublishAccountIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/carousel/projects", { name, topic, prompt, platform, slideCount, publishTargets, publishAccountIds });
      setName("");
      setTopic("");
      setPrompt("");
      setPublishTargets([]);
      setPublishAccountIds([]);
      await onCreated();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className={labelClass}>Platform</label>
          <select className={inputClass} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="instagram">Instagram (4:5)</option>
            <option value="square">Square (1:1)</option>
            <option value="linkedin">LinkedIn (4:5)</option>
            <option value="story">Story (9:16)</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Slides</label>
          <input type="number" min={2} max={10} className={inputClass} value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Topic</label>
        <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} required />
      </div>
      <div>
        <label className={labelClass}>Brief</label>
        <textarea className={`${inputClass} h-20`} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
      </div>
      <div>
        <p className={labelClass}>After approval, publish to</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {TARGETS.map((t) => {
            const ok = connected.has(t.provider);
            return (
              <label key={t.value} className={`flex items-center gap-2 text-sm ${ok ? "text-slate-700" : "text-slate-400"}`}>
                <input
                  type="checkbox"
                  disabled={!ok}
                  checked={publishTargets.includes(t.value)}
                  onChange={(e) => setPublishTargets(e.target.checked ? [...publishTargets, t.value] : publishTargets.filter((x) => x !== t.value))}
                />
                {t.label}
                {!ok ? " (connect in Integrations)" : ""}
              </label>
            );
          })}
        </div>
      </div>
      {connectedAccounts.length ? (
        <div>
          <p className={labelClass}>Or publish to specific connected accounts</p>
          <p className="text-xs text-slate-400">Additive to the platforms above — lets you reach more than one account of the same platform.</p>
          <div className="mt-2 flex flex-wrap gap-4">
            {connectedAccounts.map((acc) => (
              <label key={acc.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={publishAccountIds.includes(acc.id)}
                  onChange={(e) => setPublishAccountIds(e.target.checked ? [...publishAccountIds, acc.id] : publishAccountIds.filter((x) => x !== acc.id))}
                />
                {acc.label} <span className="text-xs text-slate-400">({acc.provider})</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Starting…" : "Generate carousel"}
      </Button>
    </form>
  );
}

export default function CarouselsPage() {
  const [projects, setProjects] = useState<CarouselProject[] | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [p, i, a] = await Promise.all([
        api.get<CarouselProject[]>("/api/carousel/projects"),
        api.get<Integration[]>("/api/integrations").catch(() => []),
        api.get<ConnectedAccount[]>("/api/accounts").catch(() => []),
      ]);
      setProjects(p);
      setConnected(new Set(i.filter((x) => x.status === "CONNECTED").map((x) => x.provider)));
      setConnectedAccounts(a.filter((x) => x.status === "CONNECTED"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader title="Carousels & Slideshows" subtitle="Brand voice and audience vocabulary are applied automatically — the same Brand Brain used by the video generator." />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!projects ? (
        <LoadingState />
      ) : (
        <div className="space-y-6">
          <Card>
            <CreateForm connected={connected} connectedAccounts={connectedAccounts} onCreated={load} />
          </Card>
          <div className="space-y-4">
            {projects.map((p) => {
              const job = p.jobs[0];
              return (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link href={`/carousels/${job?.id ?? ""}`} className="font-semibold text-brand-600 hover:underline">
                          {p.name}
                        </Link>
                        {job ? <StatusBadge status={job.state} /> : null}
                        {job?.approval ? <Badge tone={job.approval.status === "APPROVED" ? "green" : job.approval.status === "REJECTED" ? "red" : "amber"}>{job.approval.status}</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {p.topic} · {p.platform} · {p.slideCount} slides
                        {p.publishTargets.length ? ` · publishes to ${p.publishTargets.join(", ")}` : ""}
                      </p>
                      {job?.error ? <p className="mt-1 text-sm text-red-600">{job.error}</p> : null}
                      {job?.publications.length ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {job.publications.map((pub) => `${pub.target}: ${pub.status.toLowerCase()}`).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {job?.slides.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.slides.map((s) => (
                        <SlideThumb key={s.id} slide={s} />
                      ))}
                    </div>
                  ) : null}
                </Card>
              );
            })}
            {projects.length === 0 ? <p className="text-sm text-slate-500">No carousels yet.</p> : null}
          </div>
        </div>
      )}
    </ControlCenterLayout>
  );
}
