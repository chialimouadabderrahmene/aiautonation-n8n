"use client";

import { FormEvent, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, PageHeader, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";

type Carousel = { id: string; name: string; topic: string; jobs: Array<{ id: string; state: string; approval?: { status: string } | null; slides?: Array<{ imageKey: string }> }> };

export default function CarouselsPage() {
  const [items, setItems] = useState<Carousel[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", topic: "", prompt: "", slideCount: 5 });
  const load = async () => { try { setItems(await api.get<Carousel[]>("/api/carousels/projects")); } catch (e) { setError(e instanceof APIError ? e.message : "Failed to load carousels"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(""); try { await api.post("/api/carousels/projects", { ...form, slideCount: Number(form.slideCount), publishTargets: [] }); setForm({ name: "", topic: "", prompt: "", slideCount: 5 }); await load(); } catch (e) { setError(e instanceof APIError ? e.message : "Failed to create carousel"); } };
  return <ControlCenterLayout><PageHeader title="Carousel Studio" subtitle="Generate, render, review and publish multi-slide social content through the same approval and safety controls as video." />
    {error && <ErrorState message={error} />}
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card><h2 className="mb-4 text-lg font-bold">New carousel</h2><form onSubmit={submit} className="space-y-4">
        <label className={labelClass}>Name<input className={inputClass} required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label className={labelClass}>Topic<input className={inputClass} required value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} /></label>
        <label className={labelClass}>Brief<textarea className={inputClass} required rows={5} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} /></label>
        <label className={labelClass}>Slides<input className={inputClass} type="number" min={2} max={10} value={form.slideCount} onChange={e => setForm({ ...form, slideCount: Number(e.target.value) })} /></label>
        <Button type="submit">Queue carousel</Button>
      </form></Card>
      <Card><h2 className="mb-4 text-lg font-bold">Recent carousels</h2>{loading ? <LoadingState /> : items.length === 0 ? <p className="text-sm text-slate-500">No carousels yet.</p> : <div className="space-y-3">{items.map(item => { const job = item.jobs[0]; return <div key={item.id} className="rounded-lg border border-slate-200 p-4"><div className="flex justify-between"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-slate-500">{item.topic}</p></div><span className="text-xs font-semibold">{job?.state ?? "QUEUED"}</span></div><p className="mt-2 text-xs text-slate-500">Approval: {job?.approval?.status ?? "PENDING"} · Generated assets remain gated by human approval and emergency stop.</p></div>; })}</div>}</Card>
    </div></ControlCenterLayout>;
}
