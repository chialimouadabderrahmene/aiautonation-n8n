"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, StatTile, StatusBadge, timeAgo } from "@/components/ui";
import { BoltIcon, CalendarIcon, ChartIcon, DocIcon, PuzzleIcon, UsersIcon, WhatsAppIcon } from "@/components/icons";
import { api, APIError } from "@/lib/api";
import { DashboardSummary, WorkflowConfig } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

interface ContentDraft {
  id: string;
  source: string;
  platform: string | null;
  body: string;
  status: string;
  createdAt: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function PerformanceChart({ data }: { data: { date: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex items-end gap-2.5" style={{ height: 140 }}>
      {data.map((d, i) => {
        const h = Math.round((d.total / max) * 112);
        return (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end gap-2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {hover === i ? (
              <div className="absolute -top-9 z-10 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow-lg">
                {d.total} run{d.total === 1 ? "" : "s"}
              </div>
            ) : null}
            <div
              className={`w-full rounded-t-md transition-colors ${hover === i ? "bg-brand-600" : "bg-brand-500/70"}`}
              style={{ height: Math.max(h, 3) }}
            />
            <span className="text-[10px] font-medium text-slate-400">
              {new Date(d.date).toLocaleDateString(undefined, { weekday: "short" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AutomationRow({ wf }: { wf: WorkflowConfig }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3.5 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <BoltIcon size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{wf.name}</p>
          <p className="truncate text-xs text-slate-500">{wf.category}</p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="hidden sm:inline">{wf.lastExecutionAt ? `Last run ${timeAgo(wf.lastExecutionAt)}` : "Never run"}</span>
        <Badge tone={wf.enabled ? "green" : "slate"}>{wf.enabled ? "Running" : "Stopped"}</Badge>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [d, w, c, m] = await Promise.all([
        api.get<DashboardSummary>("/api/dashboard"),
        api.get<WorkflowConfig[]>("/api/workflows"),
        api.get<ContentDraft[]>("/api/engine/content-drafts"),
        api.get<{ email: string }>("/api/auth/me"),
      ]);
      setData(d);
      setWorkflows(w);
      setDrafts(c.slice(0, 4));
      setMe(m);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load dashboard");
    }
  }

  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 15_000);

  const activeAutomations = useMemo(
    () => [...workflows].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (b.lastExecutionAt ?? "").localeCompare(a.lastExecutionAt ?? "")).slice(0, 5),
    [workflows],
  );

  const steps = data
    ? [
        { n: 1, label: "Connect your apps", detail: "Add provider credentials in Integrations", done: data.integrations.connected > 0, href: "/integrations" },
        { n: 2, label: "Activate automations", detail: "Turn on the workflows you're ready to run", done: data.automations.enabled > 0, href: "/automations" },
        { n: 3, label: "Start growing", detail: "Let AI handle the repetitive work", done: data.automations.enabled > 0 && (data.today?.executions ?? 0) > 0, href: "/reports" },
      ]
    : [];
  const stepsDone = steps.filter((s) => s.done).length;

  return (
    <ControlCenterLayout>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!data ? (
        !error ? (
          <LoadingState />
        ) : null
      ) : (
        <div className="space-y-6">
          {data.testModeOverrides ? (
            <div className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-sm font-semibold text-red-800">
              TEST MODE — calls to {data.testModeOverrides.join(", ")} are redirected to a mock server. Nothing here reflects real provider accounts.
            </div>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {greeting()}, {me?.email?.split("@")[0]?.replace(/^\w/, (c) => c.toUpperCase()) ?? ""} 👋
              </h1>
              <p className="mt-1 text-sm text-slate-500">Create, automate and grow your business with AI.</p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-600">
              <CalendarIcon size={16} className="text-slate-400" />
              <div>
                <p className="font-semibold text-slate-900">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
                <p className="text-xs text-slate-400">Here&apos;s what&apos;s happening today</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile icon={<BoltIcon size={18} />} tone="green" label="Automations" value={`${data.automations.total}`} sub={`${data.automations.enabled} active · ${data.automations.total - data.automations.enabled} inactive`} />
            <StatTile icon={<DocIcon size={18} />} tone="purple" label="Content generated" value={data.metrics.content.total} pct={data.metrics.content.pct} />
            <StatTile icon={<UsersIcon size={18} />} tone="blue" label="Leads captured" value={data.metrics.leads.total} pct={data.metrics.leads.pct} />
            <StatTile icon={<WhatsAppIcon size={18} />} tone="amber" label="Messages sent" value={data.metrics.messages.total} pct={data.metrics.messages.pct} />
          </div>

          <Card className="border-brand-100 bg-gradient-to-br from-brand-50 to-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-bold text-slate-900">Get started in 3 steps</p>
                <p className="text-sm text-slate-500">Connect your tools, activate automations and let AI work for you.</p>
              </div>
              <p className="text-sm font-semibold text-brand-700">{stepsDone}/3 completed</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${(stepsDone / 3) * 100}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {steps.map((s) => (
                <Link key={s.n} href={s.href} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-brand-400">
                  <span className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {s.done ? "✓" : s.n}
                  </span>
                  <p className="text-sm font-bold text-slate-900">{s.label}</p>
                  <p className="text-xs text-slate-500">{s.detail}</p>
                </Link>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">Active Automations</p>
                    <p className="text-xs text-slate-500">Your automations are running in the background.</p>
                  </div>
                  <Link href="/automations" className="text-sm font-semibold text-brand-600 hover:underline">
                    View all →
                  </Link>
                </div>
                <div className="mt-2">
                  {activeAutomations.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">No automations yet.</p>
                  ) : (
                    activeAutomations.map((wf) => <AutomationRow key={wf.key} wf={wf} />)
                  )}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">Latest content</p>
                  <Link href="/workflow-engine/content-drafts" className="text-sm font-semibold text-brand-600 hover:underline">
                    View all →
                  </Link>
                </div>
                {drafts.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">No content generated yet.</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {drafts.map((d) => (
                      <div key={d.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase text-slate-400">{d.platform ?? d.source}</span>
                          <StatusBadge status={d.status} />
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm text-slate-700">{d.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">Performance overview</p>
                  <span className="text-xs text-slate-400">Last 7 days</span>
                </div>
                <div className="mt-4">
                  <PerformanceChart data={data.performance} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-100 pt-4 text-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Runs today</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{data.today.executions}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Successful</p>
                    <p className="mt-1 text-lg font-bold text-emerald-600">{data.today.successful}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-slate-400">Failed</p>
                    <p className={`mt-1 text-lg font-bold ${data.today.failed ? "text-red-600" : "text-slate-900"}`}>{data.today.failed}</p>
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900">Integrations</p>
                  <span className="text-xs font-semibold text-slate-400">
                    {data.integrations.connected}/{data.integrations.total} connected
                  </span>
                </div>
                <div className="mt-3 space-y-1">
                  {data.integrations.list.slice(0, 8).map((i) => (
                    <div key={i.provider} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="flex items-center gap-2 truncate text-sm text-slate-700">
                        <PuzzleIcon size={14} className="shrink-0 text-slate-400" />
                        <span className="truncate">{i.label}</span>
                      </span>
                      <StatusBadge status={i.status} />
                    </div>
                  ))}
                </div>
                <Link href="/integrations" className="mt-3 block text-sm font-semibold text-brand-600 hover:underline">
                  Manage all →
                </Link>
              </Card>

              <Card>
                <p className="font-bold text-slate-900">Recent activity</p>
                <div className="mt-3 space-y-3">
                  {data.recentActivity.length === 0 ? (
                    <p className="text-sm text-slate-400">Nothing yet.</p>
                  ) : (
                    data.recentActivity.map((a, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                          <ChartIcon size={13} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold capitalize text-slate-800">{a.label}</p>
                          <p className="text-xs text-slate-400">{timeAgo(a.at)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <Link href="/executions" className="mt-3 block text-sm font-semibold text-brand-600 hover:underline">
                  View all →
                </Link>
              </Card>

              {data.actionRequired.length > 0 ? (
                <Card className="border-amber-200 bg-amber-50">
                  <p className="font-bold text-amber-900">{data.actionRequired.length} item(s) need attention</p>
                  <div className="mt-2 space-y-2">
                    {data.actionRequired.slice(0, 4).map((a, i) => (
                      <Link key={i} href={a.link} className="block rounded-lg bg-white/70 p-2 text-xs text-amber-900 hover:bg-white">
                        <span className="font-semibold">{a.label}</span>
                        <span className="block truncate text-amber-700">{a.detail}</span>
                      </Link>
                    ))}
                  </div>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </ControlCenterLayout>
  );
}
