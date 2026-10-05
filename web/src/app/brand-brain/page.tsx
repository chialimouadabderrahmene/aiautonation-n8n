"use client";

import { FormEvent, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, Notice, PageHeader, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface BrandProfile {
  id: string;
  name: string;
  isActive: boolean;
  voiceAdjectives: string[];
  tone: string | null;
  formality: string | null;
  sentenceStyle: string | null;
  preferredPhrases: string[];
  bannedWords: string[];
  ctaStyle: string | null;
  exampleSentences: string[];
  version: number;
}

interface VocabularyEntry {
  id: string;
  term: string;
  meaning: string | null;
  category: string | null;
}

interface AudienceProfile {
  id: string;
  name: string;
  isActive: boolean;
  language: string | null;
  marketDescription: string | null;
  commonPhrases: string[];
  objections: string[];
  painPoints: string[];
  version: number;
  vocabulary: VocabularyEntry[];
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const toLines = (a: string[]) => a.join("\n");

function BrandForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [voiceAdjectives, setVoiceAdjectives] = useState("");
  const [tone, setTone] = useState("");
  const [formality, setFormality] = useState("");
  const [sentenceStyle, setSentenceStyle] = useState("");
  const [preferredPhrases, setPreferredPhrases] = useState("");
  const [bannedWords, setBannedWords] = useState("");
  const [ctaStyle, setCtaStyle] = useState("");
  const [exampleSentences, setExampleSentences] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/api/brand/profiles", {
        name,
        voiceAdjectives: lines(voiceAdjectives),
        tone: tone || null,
        formality: formality || null,
        sentenceStyle: sentenceStyle || null,
        preferredPhrases: lines(preferredPhrases),
        bannedWords: lines(bannedWords),
        ctaStyle: ctaStyle || null,
        exampleSentences: lines(exampleSentences),
      });
      setName("");
      setVoiceAdjectives("");
      setTone("");
      setFormality("");
      setSentenceStyle("");
      setPreferredPhrases("");
      setBannedWords("");
      setCtaStyle("");
      setExampleSentences("");
      await onSaved();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className={labelClass}>Name</label>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eki — launch voice" required />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelClass}>Voice adjectives (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={voiceAdjectives} onChange={(e) => setVoiceAdjectives(e.target.value)} placeholder={"trustworthy\nwarm\ndirect"} />
        </div>
        <div>
          <label className={labelClass}>Tone</label>
          <input className={inputClass} value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. confident, pain-driven" />
        </div>
        <div>
          <label className={labelClass}>Formality</label>
          <input className={inputClass} value={formality} onChange={(e) => setFormality(e.target.value)} placeholder="e.g. casual, not corporate" />
        </div>
        <div>
          <label className={labelClass}>CTA style</label>
          <input className={inputClass} value={ctaStyle} onChange={(e) => setCtaStyle(e.target.value)} placeholder="e.g. one clear action word, never pushy" />
        </div>
      </div>
      <div>
        <label className={labelClass}>Sentence style</label>
        <input className={inputClass} value={sentenceStyle} onChange={(e) => setSentenceStyle(e.target.value)} placeholder="e.g. short sentences, no jargon" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelClass}>Preferred phrases (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={preferredPhrases} onChange={(e) => setPreferredPhrases(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Banned words (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={bannedWords} onChange={(e) => setBannedWords(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Example sentences — the voice done right (one per line)</label>
        <textarea className={`${inputClass} h-20`} value={exampleSentences} onChange={(e) => setExampleSentences(e.target.value)} />
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Add brand profile"}
      </Button>
    </form>
  );
}

function AudienceForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("");
  const [marketDescription, setMarketDescription] = useState("");
  const [commonPhrases, setCommonPhrases] = useState("");
  const [painPoints, setPainPoints] = useState("");
  const [objections, setObjections] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/api/brand/audiences", {
        name,
        language: language || null,
        marketDescription: marketDescription || null,
        commonPhrases: lines(commonPhrases),
        painPoints: lines(painPoints),
        objections: lines(objections),
      });
      setName("");
      setLanguage("");
      setMarketDescription("");
      setCommonPhrases("");
      setPainPoints("");
      setObjections("");
      await onSaved();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nigerian diaspora vendors — UK" required />
        </div>
        <div>
          <label className={labelClass}>Language / register</label>
          <input className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English with occasional Pidgin" />
        </div>
      </div>
      <div>
        <label className={labelClass}>Who they are</label>
        <textarea className={`${inputClass} h-16`} value={marketDescription} onChange={(e) => setMarketDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <label className={labelClass}>Phrases they actually use (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={commonPhrases} onChange={(e) => setCommonPhrases(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Real pain points (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={painPoints} onChange={(e) => setPainPoints(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Objections to pre-empt (one per line)</label>
          <textarea className={`${inputClass} h-20`} value={objections} onChange={(e) => setObjections(e.target.value)} />
        </div>
      </div>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Add audience profile"}
      </Button>
    </form>
  );
}

function VocabularyEditor({ audience, onChanged }: { audience: AudienceProfile; onChanged: () => Promise<void> }) {
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");
  const [category, setCategory] = useState("slang");
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/brand/audiences/${audience.id}/vocabulary`, { term, meaning: meaning || null, category });
      setTerm("");
      setMeaning("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <p className={labelClass}>Vocabulary glossary</p>
      <ul className="mt-2 space-y-1 text-sm">
        {audience.vocabulary.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-2">
            <span>
              <span className="font-semibold">{v.term}</span>
              {v.meaning ? <span className="text-slate-500"> — {v.meaning}</span> : null}
              {v.category ? <span className="ml-2 text-xs text-slate-400">({v.category})</span> : null}
            </span>
            <button
              type="button"
              className="text-xs text-red-600 hover:underline"
              onClick={async () => {
                await api.delete(`/api/brand/vocabulary/${v.id}`);
                await onChanged();
              }}
            >
              remove
            </button>
          </li>
        ))}
        {audience.vocabulary.length === 0 ? <li className="text-slate-400">No terms yet.</li> : null}
      </ul>
      <form onSubmit={add} className="mt-2 flex flex-wrap items-end gap-2">
        <input className={`${inputClass} mt-0 w-32`} placeholder="term" value={term} onChange={(e) => setTerm(e.target.value)} />
        <input className={`${inputClass} mt-0 w-48`} placeholder="meaning (optional)" value={meaning} onChange={(e) => setMeaning(e.target.value)} />
        <select className={`${inputClass} mt-0 w-32`} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="slang">slang</option>
          <option value="product">product</option>
          <option value="painPoint">painPoint</option>
          <option value="objection">objection</option>
          <option value="other">other</option>
        </select>
        <Button type="submit" variant="secondary" disabled={busy}>
          Add term
        </Button>
      </form>
    </div>
  );
}

interface Version {
  id: string;
  createdBy: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

function VersionHistory({ kind, profileId, onChanged }: { kind: "profiles" | "audiences"; profileId: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle() {
    if (!open && !versions) {
      const v = await api.get<Version[]>(`/api/brand/${kind}/${profileId}/versions`).catch(() => []);
      setVersions(v);
    }
    setOpen(!open);
  }

  return (
    <div className="mt-2">
      <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={toggle}>
        {open ? "Hide version history" : "Version history"}
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
          {(versions ?? []).map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2">
              <span>
                {new Date(v.createdAt).toLocaleString()} · {v.createdBy} · &ldquo;{String(v.snapshot.name ?? "")}&rdquo;
              </span>
              <button
                type="button"
                className="font-semibold text-brand-600 hover:underline disabled:opacity-50"
                disabled={busy === v.id}
                onClick={async () => {
                  setBusy(v.id);
                  try {
                    await api.post(`/api/brand/${kind}/${profileId}/rollback/${v.id}`);
                    setVersions(null);
                    setOpen(false);
                    await onChanged();
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === v.id ? "Restoring…" : "Restore this version"}
              </button>
            </li>
          ))}
          {versions && versions.length === 0 ? <li>No prior versions — nothing has been edited yet.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function TestProfilePanel({ brandId, audienceId }: { brandId?: string; audienceId?: string }) {
  const [brief, setBrief] = useState("");
  const [result, setResult] = useState<{ sample: string; score: number; onBrand: boolean; violations: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.post("/api/brand/test", { brief, brandId, audienceId }));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <h3 className="mb-2 text-sm font-bold text-slate-700">Test this profile against sample content</h3>
      <p className="mb-2 text-xs text-slate-500">Runs a real AI call through the active brand + audience profiles and the same critic the pipeline uses — never a fake pass.</p>
      <div className="flex flex-wrap items-end gap-2">
        <input className={`${inputClass} mt-0 flex-1`} placeholder="e.g. a caption announcing a new vendor feature" value={brief} onChange={(e) => setBrief(e.target.value)} />
        <Button variant="secondary" onClick={run} disabled={busy || !brief.trim()}>
          {busy ? "Testing…" : "Run test"}
        </Button>
      </div>
      {error ? (
        <div className="mt-2">
          <Notice tone="red">{error}</Notice>
        </div>
      ) : null}
      {result ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="italic">&ldquo;{result.sample}&rdquo;</p>
          <div className="mt-2 flex items-center gap-2">
            <Badge tone={result.onBrand ? "green" : "amber"}>{result.onBrand ? "On brand" : "Drifted"}</Badge>
            <span className="text-xs text-slate-500">score {result.score}/100</span>
          </div>
          {result.violations.length ? <p className="mt-1 text-xs text-amber-700">Violations: {result.violations.join(", ")}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

export default function BrandBrainPage() {
  const [brands, setBrands] = useState<BrandProfile[] | null>(null);
  const [audiences, setAudiences] = useState<AudienceProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [b, a] = await Promise.all([api.get<BrandProfile[]>("/api/brand/profiles"), api.get<AudienceProfile[]>("/api/brand/audiences")]);
      setBrands(b);
      setAudiences(a);
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader title="Brand Brain" subtitle="The brand voice and audience vocabulary every script and carousel is generated against — set once, applied automatically, never retyped per request." />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!brands || !audiences ? (
        <LoadingState />
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Brand voice profiles</h2>
            <div className="mb-4 space-y-3">
              {brands.map((b) => (
                <Card key={b.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{b.name}</span>
                        {b.isActive ? <Badge tone="green">active</Badge> : null}
                        <span className="text-xs text-slate-400">v{b.version}</span>
                      </div>
                      {b.voiceAdjectives.length ? <p className="mt-1 text-sm text-slate-600">{b.voiceAdjectives.join(", ")}</p> : null}
                      <VersionHistory kind="profiles" profileId={b.id} onChanged={load} />
                    </div>
                    <div className="flex gap-2">
                      {!b.isActive ? (
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            await api.post(`/api/brand/profiles/${b.id}/activate`);
                            await load();
                          }}
                        >
                          Make active
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await api.delete(`/api/brand/profiles/${b.id}`);
                          await load();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
              {brands.length === 0 ? <p className="text-sm text-slate-500">No brand profile yet — nothing is injected into scripts until one is active.</p> : null}
            </div>
            <Card>
              <BrandForm onSaved={load} />
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Audience vocabulary profiles</h2>
            <div className="mb-4 space-y-3">
              {audiences.map((a) => (
                <Card key={a.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{a.name}</span>
                        {a.isActive ? <Badge tone="green">active</Badge> : null}
                        <span className="text-xs text-slate-400">v{a.version}</span>
                      </div>
                      {a.marketDescription ? <p className="mt-1 text-sm text-slate-600">{a.marketDescription}</p> : null}
                      <VersionHistory kind="audiences" profileId={a.id} onChanged={load} />
                    </div>
                    <div className="flex gap-2">
                      {!a.isActive ? (
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            await api.post(`/api/brand/audiences/${a.id}/activate`);
                            await load();
                          }}
                        >
                          Make active
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        onClick={async () => {
                          await api.delete(`/api/brand/audiences/${a.id}`);
                          await load();
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <VocabularyEditor audience={a} onChanged={load} />
                </Card>
              ))}
              {audiences.length === 0 ? <p className="text-sm text-slate-500">No audience profile yet — the critic pass still runs, but nothing to check vocabulary against.</p> : null}
            </div>
            <Card>
              <AudienceForm onSaved={load} />
            </Card>
          </section>

          <TestProfilePanel brandId={brands.find((b) => b.isActive)?.id} audienceId={audiences.find((a) => a.isActive)?.id} />
        </div>
      )}
    </ControlCenterLayout>
  );
}
