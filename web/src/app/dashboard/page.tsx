"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, Checklist, ErrorState, LoadingState, MetricTile, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ComponentHealth, DashboardSummary } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";
import { formatMicros } from "@/lib/usageDisplay";

const COMPONENTS: { key: keyof DashboardSummary["health"]; label: string; icon: string }[] = [
  { key: "api", label: "API", icon: "⌁" }, { key: "worker", label: "Worker", icon: "▶" }, { key: "database", label: "Database", icon: "▣" },
  { key: "redis", label: "Queue", icon: "≋" }, { key: "nativeAutomation", label: "Automation", icon: "✦" }, { key: "storage", label: "Storage", icon: "□" },
];

function HealthRow({ label, icon, health }: { label: string; icon: string; health: ComponentHealth }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-sm font-bold text-emerald-700 shadow-sm">{icon}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold text-slate-800">{label}</p><p className="truncate text-xs text-slate-400">{health.message}</p></div><StatusBadge status={health.status} /></div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  async function load() { try { setData(await api.get<DashboardSummary>("/api/dashboard")); setError(""); } catch (err) { setError(err instanceof APIError ? err.message : "Failed to load dashboard"); } }
  useEffect(() => { void load(); }, []); usePolling(load, 15_000);
  if (!data && !error) return <ControlCenterLayout><LoadingState label="Loading your command center…" /></ControlCenterLayout>;
  if (error) return <ControlCenterLayout><ErrorState message={error} onRetry={load} /></ControlCenterLayout>;
  if (!data) return null;
  const tone = data.system === "READY" ? "green" : data.system === "PARTIALLY_READY" ? "amber" : "red";
  return <ControlCenterLayout>
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-[28px] bg-[#0b1f1a] px-6 py-7 text-white shadow-xl shadow-emerald-950/10 lg:px-9 lg:py-9">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" /><div className="absolute -bottom-32 right-40 h-64 w-64 rounded-full bg-teal-300/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end"><div><p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">Good morning, EKI team</p><h1 className="max-w-2xl text-3xl font-black tracking-tight lg:text-5xl">Turn attention into activated storefronts.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-emerald-100/65">Your content, approvals, publishing, leads and attribution — one operating view.</p></div><div className="flex items-center gap-3"><Badge tone={tone}>{data.system.replace("_", " ")}</Badge><Link href="/content-studio" className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-[#0b1f1a] transition hover:bg-emerald-300">Create content →</Link></div></div>
        <div className="relative mt-8 grid grid-cols-2 gap-3 border-t border-white/10 pt-5 md:grid-cols-4"><div><p className="text-xs text-emerald-100/50">Runs today</p><p className="mt-1 text-2xl font-black">{data.today.executions}</p></div><div><p className="text-xs text-emerald-100/50">Awaiting approval</p><p className="mt-1 text-2xl font-black">{data.video.pendingApprovals}</p></div><div><p className="text-xs text-emerald-100/50">Ready automations</p><p className="mt-1 text-2xl font-black">{data.automations.ready}</p></div><div><p className="text-xs text-emerald-100/50">Last refresh</p><p className="mt-1 text-sm font-bold">{timeAgo(data.generatedAt)}</p></div></div>
      </section>
      {data.testModeOverrides ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">TEST MODE — provider calls are redirected to: {data.testModeOverrides.join(", ")}</div> : null}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4"><MetricTile label="Connected integrations" value={`${data.integrations.connected}/${data.integrations.total}`} tone={data.integrations.connected ? "green" : "slate"} /><MetricTile label="Content ready" value={data.video.completed} tone="blue" /><MetricTile label="Failed runs" value={data.today.failed} tone={data.today.failed ? "red" : "slate"} /><MetricTile label="Unknown cost" value={data.usage.unknownCalls} tone={data.usage.unknownCalls ? "red" : "green"} /></section>
      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="p-0"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><h2 className="font-black text-slate-900">Operational health</h2><p className="mt-1 text-xs text-slate-400">Every dependency required to create and publish safely.</p></div><Link href="/integrations" className="text-sm font-bold text-emerald-700">Manage →</Link></div><div className="grid gap-3 p-5 sm:grid-cols-2">{COMPONENTS.map((c) => <HealthRow key={c.key} label={c.label} icon={c.icon} health={data.health[c.key]} />)}</div></Card>
        <Card><div className="flex items-start justify-between"><div><h2 className="font-black text-slate-900">Approvals queue</h2><p className="mt-1 text-xs text-slate-400">Human control before publishing.</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-sm font-black text-amber-700">{data.video.pendingApprovals}</span></div><div className="mt-6 rounded-2xl bg-slate-50 p-4"><p className="text-sm font-bold text-slate-700">{data.video.pendingApprovals ? "Content needs your decision" : "Nothing waiting"}</p><p className="mt-1 text-xs leading-5 text-slate-400">Review product truth, claims, captions and destinations before anything leaves the system.</p></div><Link href="/approvals" className="mt-5 inline-flex text-sm font-bold text-emerald-700">Open approval queue →</Link></Card>
      </section>
      <section className="grid gap-5 lg:grid-cols-2"><Card><div className="flex items-start justify-between"><div><h2 className="font-black text-slate-900">Content pipeline</h2><p className="mt-1 text-xs text-slate-400">Video and carousel production status.</p></div><Link href="/video" className="text-sm font-bold text-emerald-700">Open studio →</Link></div><div className="mt-5"><Checklist items={data.video.detail} /></div><div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center"><div><p className="text-xl font-black text-slate-900">{data.video.running}</p><p className="text-[11px] text-slate-400">Generating</p></div><div><p className="text-xl font-black text-emerald-600">{data.video.completed}</p><p className="text-[11px] text-slate-400">Ready</p></div><div><p className="text-xl font-black text-red-600">{data.video.failed}</p><p className="text-[11px] text-slate-400">Failed</p></div></div></Card><Card><div className="flex items-start justify-between"><div><h2 className="font-black text-slate-900">Usage & cost truth</h2><p className="mt-1 text-xs text-slate-400">Reported, estimated and unknown kept separate.</p></div><Link href="/reports" className="text-sm font-bold text-emerald-700">Reports →</Link></div><div className="mt-5 space-y-3"><div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3"><span className="text-sm font-semibold text-emerald-900">Provider reported</span><span className="font-black text-emerald-700">{formatMicros(data.usage.providerReportedMicros)}</span></div><div className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"><span className="text-sm font-semibold text-amber-900">Estimated</span><span className="font-black text-amber-700">{formatMicros(data.usage.estimatedMicros)}</span></div><div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className="text-sm font-semibold text-slate-600">Provider calls</span><span className="font-black text-slate-900">{data.usage.calls}</span></div></div></Card></section>
      {data.actionRequired.length ? <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-black text-slate-900">Action center</h2><p className="mt-1 text-xs text-slate-400">Items that need an operator decision.</p></div><Badge tone="amber">{data.actionRequired.length} open</Badge></div><div className="grid gap-3 lg:grid-cols-2">{data.actionRequired.map((a, i) => <Link key={`${a.label}-${i}`} href={a.link} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 transition hover:-translate-y-0.5 hover:shadow-md"><p className="font-bold text-amber-950">{a.label}</p><p className="mt-1 text-sm text-amber-800/70">{a.detail}</p></Link>)}</div></section> : <Card className="border-emerald-200 bg-emerald-50"><p className="font-bold text-emerald-900">All clear</p><p className="mt-1 text-sm text-emerald-800/70">No action is currently required from the operator.</p></Card>}
    </div>
  </ControlCenterLayout>;
}
