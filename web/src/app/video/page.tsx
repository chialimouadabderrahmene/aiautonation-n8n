"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, Checklist, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, inputClass, labelClass, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ACTIVE_VIDEO_STATES, Integration, MediaFile, ReadinessDetail, VideoProject } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const PLATFORMS = ["Instagram Reel", "TikTok", "YouTube Short", "Facebook Video", "LinkedIn Video", "X Video", "Website / Ads"];
const TONES = ["Professional", "Energetic", "Friendly", "Premium", "Educational", "Emotional", "Playful"];
const DURATIONS = [15, 20, 30, 45, 60];
const STYLES = ["Realistic", "Cinematic", "Commercial", "Documentary", "Lifestyle", "Minimal", "Product showcase", "Animated"];
const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "it", label: "Italian" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "yo", label: "Yoruba" },
  { value: "ha", label: "Hausa" },
  { value: "ig", label: "Igbo" },
];
const TARGETS = [
  { value: "instagram", label: "Instagram Reels", provider: "meta" },
  { value: "facebook", label: "Facebook Page", provider: "meta" },
  { value: "x", label: "X", provider: "x" },
  { value: "linkedin", label: "LinkedIn", provider: "linkedin" },
];

interface VideoReadiness {
  readiness: string;
  detail: ReadinessDetail[];
  approval: { readiness: string; detail: ReadinessDetail[] };
}

const EMPTY = {
  name: "",
  contentType: PLATFORMS[0]!,
  topic: "",
  prompt: "",
  audience: "",
  language: "en",
  tone: TONES[0]!,
  durationSec: 30,
  aspectRatio: "9:16",
  visualStyle: STYLES[0]!,
  voicePreset: "",
  subtitles: true,
  musicFileId: "",
  brand: "Eki",
  cta: "",
  publishTargets: [] as string[],
};

export default function VideoGeneratorPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [readiness, setReadiness] = useState<VideoReadiness | null>(null);
  const [music, setMusic] = useState<MediaFile[]>([]);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState(EMPTY);

  async function load() {
    try {
      const [p, r, m, i] = await Promise.all([
        api.get<VideoProject[]>("/api/video/projects"),
        api.get<VideoReadiness>("/api/video/readiness"),
        api.get<MediaFile[]>("/api/media/music").catch(() => []),
        api.get<Integration[]>("/api/integrations").catch(() => []),
      ]);
      setProjects(p);
      setReadiness(r);
      setMusic(m);
      setConnected(new Set(i.filter((x) => x.status === "CONNECTED").map((x) => x.provider)));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    api
      .get<{ values: Record<string, unknown> }>("/api/settings")
      .then(({ values }) =>
        setForm((f) => ({
          ...f,
          language: String(values.defaultLanguage ?? f.language),
          tone: String(values.defaultTone ?? f.tone),
          durationSec: Number(values.defaultDurationSec ?? f.durationSec),
          aspectRatio: String(values.defaultAspectRatio ?? f.aspectRatio),
        })),
      )
      .catch(() => undefined);
  }, []);
  const anyActive = projects.some((p) => p.jobs?.[0] && ACTIVE_VIDEO_STATES.includes(p.jobs[0].state));
  usePolling(load, 5000, anyActive);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError("");
    try {
      const body = {
        ...form,
        audience: form.audience || undefined,
        cta: form.cta || undefined,
        voicePreset: form.voicePreset || undefined,
        musicFileId: form.musicFileId || undefined,
      };
      const { job } = await api.post<{ job: { id: string } }>("/api/video/projects", body);
      router.push(`/video/${job.id}`);
    } catch (err) {
      setFormError(err instanceof APIError ? err.message : "Failed to create the video");
      setCreating(false);
    }
  }

  const blocked = readiness && readiness.readiness !== "READY";

  return (
    <ControlCenterLayout>
      <PageHeader title="Video Generator" subtitle="Brief → AI script → ElevenLabs voice → Runway scenes → FFmpeg assembly + subtitles → quality check → Telegram approval → publish." />

      {readiness ? (
        <Card className={`mb-6 ${blocked ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900">Video pipeline</p>
            <StatusBadge status={readiness.readiness} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Checklist items={readiness.detail} />
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Telegram approval ({readiness.approval.readiness.toLowerCase()})</p>
              <Checklist items={readiness.approval.detail} />
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="mb-8">
        <h2 className="text-lg font-bold text-slate-900">New video</h2>
        <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>Project name *</label>
            <input required maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Topic *</label>
            <input required maxLength={300} value={form.topic} onChange={(e) => set("topic", e.target.value)} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Prompt / brief *</label>
            <textarea required rows={4} maxLength={2000} value={form.prompt} onChange={(e) => set("prompt", e.target.value)} className={inputClass} placeholder="What should the video show and say? Facts only — the AI is told never to invent claims." />
          </div>
          <div>
            <label className={labelClass}>Platform</label>
            <select value={form.contentType} onChange={(e) => set("contentType", e.target.value)} className={inputClass}>
              {PLATFORMS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Audience</label>
            <input maxLength={300} value={form.audience} onChange={(e) => set("audience", e.target.value)} className={inputClass} placeholder="e.g. African diaspora families in Europe" />
          </div>
          <div>
            <label className={labelClass}>Language</label>
            <select value={form.language} onChange={(e) => set("language", e.target.value)} className={inputClass}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Tone</label>
            <select value={form.tone} onChange={(e) => set("tone", e.target.value)} className={inputClass}>
              {TONES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Duration</label>
            <select value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value))} className={inputClass}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} seconds
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Aspect ratio</label>
            <select value={form.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)} className={inputClass}>
              <option value="9:16">9:16 vertical (Reels, TikTok, Shorts)</option>
              <option value="16:9">16:9 landscape</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Visual style</label>
            <select value={form.visualStyle} onChange={(e) => set("visualStyle", e.target.value)} className={inputClass}>
              {STYLES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Voice (ElevenLabs voice ID)</label>
            <input value={form.voicePreset} onChange={(e) => set("voicePreset", e.target.value)} className={inputClass} placeholder="Blank = default voice from Integrations" />
          </div>
          <div>
            <label className={labelClass}>Music</label>
            <select value={form.musicFileId} onChange={(e) => set("musicFileId", e.target.value)} className={inputClass}>
              <option value="">No music</option>
              {music.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Upload tracks in <Link href="/settings" className="underline">Settings → Music library</Link>.
            </p>
          </div>
          <div>
            <label className={labelClass}>Call to action</label>
            <input maxLength={200} value={form.cta} onChange={(e) => set("cta", e.target.value)} className={inputClass} placeholder="e.g. Download Eki today" />
          </div>
          <div>
            <label className={labelClass}>Brand</label>
            <input maxLength={60} value={form.brand} onChange={(e) => set("brand", e.target.value)} className={inputClass} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.subtitles} onChange={(e) => set("subtitles", e.target.checked)} /> Burn in subtitles
          </label>
          <div className="md:col-span-2">
            <p className={labelClass}>After approval, publish to</p>
            <div className="mt-2 flex flex-wrap gap-4">
              {TARGETS.map((t) => {
                const ok = connected.has(t.provider);
                return (
                  <label key={t.value} className={`flex items-center gap-2 text-sm ${ok ? "text-slate-700" : "text-slate-400"}`}>
                    <input
                      type="checkbox"
                      disabled={!ok}
                      checked={form.publishTargets.includes(t.value)}
                      onChange={(e) => set("publishTargets", e.target.checked ? [...form.publishTargets, t.value] : form.publishTargets.filter((x) => x !== t.value))}
                    />
                    {t.label}
                    {!ok ? " (connect in Integrations)" : ""}
                  </label>
                );
              })}
            </div>
          </div>
          {formError ? (
            <div className="md:col-span-2">
              <Notice tone="red">{formError}</Notice>
            </div>
          ) : null}
          <div className="md:col-span-2">
            <Button type="submit" disabled={creating || Boolean(blocked)}>
              {creating ? "Queuing…" : blocked ? "GENERATE VIDEO (blocked — see above)" : "GENERATE VIDEO"}
            </Button>
            <p className="mt-2 text-xs text-slate-400">Generation runs in the background (typically several minutes). You can leave this page; progress is saved.</p>
          </div>
        </form>
      </Card>

      <h2 className="mb-3 text-lg font-bold text-slate-900">Projects</h2>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : projects.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No videos yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => {
            const job = p.jobs?.[0];
            return (
              <Link key={p.id} href={job ? `/video/${job.id}` : "#"}>
                <Card className="hover:border-brand-500">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.contentType} · {p.durationSec}s · {p.aspectRatio} · {timeAgo(p.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job?.approval ? <StatusBadge status={job.approval.status} /> : null}
                      {job ? <StatusBadge status={job.state} /> : null}
                    </div>
                  </div>
                  {job && ACTIVE_VIDEO_STATES.includes(job.state) ? (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand-500 transition-all" style={{ width: `${job.progress}%` }} />
                    </div>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </ControlCenterLayout>
  );
}
