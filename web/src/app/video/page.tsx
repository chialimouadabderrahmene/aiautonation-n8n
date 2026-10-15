"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ReadinessDetail, VideoProject } from "@/lib/types";

const CONTENT_TYPES = ["Instagram Reel", "TikTok", "Facebook Video", "YouTube Short", "Promo", "Product video", "Educational", "Announcement"];
const TONES = ["Professional", "Energetic", "Friendly", "Premium", "Educational", "Emotional"];
const DURATIONS = [15, 30, 45, 60];
const RATIOS = ["9:16", "16:9", "1:1"];
const STYLES = ["Realistic", "Cinematic", "Commercial", "Documentary", "Social media", "Minimal", "Product showcase"];

export default function VideoGeneratorPage() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [readiness, setReadiness] = useState<{ readiness: string; detail: ReadinessDetail[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contentType: CONTENT_TYPES[0],
    topic: "",
    prompt: "",
    audience: "",
    language: "en",
    tone: TONES[0],
    durationSec: 30,
    aspectRatio: "9:16",
    visualStyle: STYLES[0],
    subtitles: true,
    brand: "Eki",
    cta: "",
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [p, r] = await Promise.all([
        api.get<VideoProject[]>("/api/video/projects"),
        api.get<{ readiness: string; detail: ReadinessDetail[] }>("/api/video/readiness"),
      ]);
      setProjects(p);
      setReadiness(r);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/api/video/projects", form);
      await load();
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  const blocked = readiness && readiness.readiness !== "READY";

  return (
    <ControlCenterLayout>
      <PageHeader title="Video Generator" subtitle="Idea → script → storyboard → voiceover → visuals → assembly → subtitles → quality check → MP4." />

      {readiness && blocked ? (
        <Card className="mb-6 border-amber-200 bg-amber-50">
          <p className="font-semibold text-amber-800">Video pipeline is not ready yet</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {readiness.detail.map((d) => (
              <span key={d.requirement} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {d.ok ? "✓" : "✕"} {d.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm text-amber-700">Configure the missing providers in Integrations, then come back here.</p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-4 text-lg font-bold text-slate-900">New project</h2>
          <form onSubmit={onSubmit} className="space-y-3">
            <Field label="Project name">
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input" />
            </Field>
            <Field label="Content type">
              <select value={form.contentType} onChange={(e) => setForm((f) => ({ ...f, contentType: e.target.value }))} className="input">
                {CONTENT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Topic">
              <input required value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} className="input" />
            </Field>
            <Field label="Prompt / brief">
              <textarea required rows={3} value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))} className="input" />
            </Field>
            <Field label="Audience (optional)">
              <input value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))} className="input" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tone">
                <select value={form.tone} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} className="input">
                  {TONES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Visual style">
                <select value={form.visualStyle} onChange={(e) => setForm((f) => ({ ...f, visualStyle: e.target.value }))} className="input">
                  {STYLES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Duration">
                <select value={form.durationSec} onChange={(e) => setForm((f) => ({ ...f, durationSec: Number(e.target.value) }))} className="input">
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} sec
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Aspect ratio">
                <select value={form.aspectRatio} onChange={(e) => setForm((f) => ({ ...f, aspectRatio: e.target.value }))} className="input">
                  {RATIOS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Call to action (optional)">
              <input value={form.cta} onChange={(e) => setForm((f) => ({ ...f, cta: e.target.value }))} className="input" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.subtitles} onChange={(e) => setForm((f) => ({ ...f, subtitles: e.target.checked }))} />
              Burn in subtitles
            </label>
            <Button type="submit" disabled={creating || !!blocked}>
              {creating ? "Creating..." : "Generate video"}
            </Button>
          </form>
        </Card>

        <div>
          <h2 className="mb-4 text-lg font-bold text-slate-900">Projects</h2>
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={load} />
          ) : projects.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-500">No video projects yet.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => {
                const job = p.jobs?.[0];
                return (
                  <Link key={p.id} href={job ? `/video/${job.id}` : "#"}>
                    <Card className="hover:border-brand-500">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{p.name}</p>
                          <p className="text-sm text-slate-500">
                            {p.contentType} · {p.durationSec}s · {p.aspectRatio}
                          </p>
                        </div>
                        {job ? <Badge tone={statusTone(job.state)}>{job.state.replace(/_/g, " ")}</Badge> : null}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #e2e8f0;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
        }
        .input:focus {
          border-color: #0a9d5c;
        }
      `}</style>
    </ControlCenterLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">{label}</label>
      {children}
    </div>
  );
}
