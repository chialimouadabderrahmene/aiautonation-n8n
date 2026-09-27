"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, Checklist, ErrorState, LoadingState, MetricTile, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ComponentHealth, DashboardSummary } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const COMPONENTS: { key: keyof DashboardSummary["health"]; label: string }[] = [
  { key: "api", label: "API" },
  { key: "worker", label: "Video worker" },
  { key: "database", label: "Database" },
  { key: "redis", label: "Queue (Redis)" },
  { key: "n8n", label: "n8n" },
  { key: "storage", label: "Media storage" },
];

function HealthCard({ label, h }: { label: string; h: ComponentHealth }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <StatusBadge status={h.status} />
      </div>
      <p className="mt-2 text-xs text-slate-500">{h.message}</p>
      <p className="mt-2 text-[11px] text-slate-400">
        Checked {timeAgo(h.checkedAt)}
        {h.latencyMs !== undefined ? ` · ${h.latencyMs} ms` : ""}
        {h.lastSeenAt ? ` · last heartbeat ${timeAgo(h.lastSeenAt)}` : ""}
      </p>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setData(await api.get<DashboardSummary>("/api/dashboard"));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load dashboard");
    }
  }

  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 15_000);

  const systemTone = data?.system === "READY" ? "green" : data?.system === "PARTIALLY_READY" ? "amber" : "red";

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Dashboard"
        subtitle={data ? `Live status — refreshed ${timeAgo(data.generatedAt)} (auto every 15 s)` : "Live system status"}
        action={data ? <Badge tone={systemTone}>{data.system.replace("_", " ")}</Badge> : null}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!data ? (
        !error ? <LoadingState /> : null
      ) : (
        <div className="space-y-8">
          {data.testModeOverrides ? (
            <div className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-sm font-semibold text-red-800">
              TEST MODE — calls to {data.testModeOverrides.join(", ")} are redirected to a mock server. Nothing on this deployment reflects real provider accounts. Remove ALLOW_PROVIDER_OVERRIDES for production.
            </div>
          ) : null}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">System health</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {COMPONENTS.map((c) => (
                <HealthCard key={c.key} label={c.label} h={data.health[c.key]} />
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between">
                <p className="font-bold text-slate-900">Video automation</p>
                <StatusBadge status={data.video.readiness} />
              </div>
              <div className="mt-3">
                <Checklist items={data.video.detail} />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase text-slate-400">Telegram approval</p>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={data.video.approvalReadiness} />
              </div>
              <div className="mt-2">
                <Checklist items={data.video.approvalDetail} />
              </div>
              <p className="mt-4 text-sm text-slate-500">
                {data.video.running} generating · {data.video.completed} ready · {data.video.failed} failed · {data.video.pendingApprovals} awaiting approval
              </p>
              <Link href="/video" className="mt-3 inline-block text-sm font-semibold text-brand-600">
                Open Video Generator →
              </Link>
            </Card>

            <Card>
              <p className="font-bold text-slate-900">Integrations</p>
              <p className="mt-1 text-sm text-slate-500">
                {data.integrations.connected}/{data.integrations.total} connected · {data.integrations.actionRequired} need attention · {data.integrations.notConfigured} not configured
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                {data.integrations.list.map((i) => (
                  <li key={i.provider} className="flex items-center justify-between gap-2">
                    <span className="truncate text-slate-700">{i.label}</span>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
              <Link href="/integrations" className="mt-3 inline-block text-sm font-semibold text-brand-600">
                Manage integrations →
              </Link>
            </Card>
          </section>

          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricTile label="Automations ready" value={`${data.automations.ready}/${data.automations.total}`} tone={data.automations.ready ? "green" : "slate"} />
            <MetricTile label="Active in n8n" value={`${data.automations.activeInN8n}/${data.automations.presentInN8n}`} tone="blue" />
            <MetricTile label="Runs today" value={data.today.executions} />
            <MetricTile label="Failed today" value={data.today.failed} tone={data.today.failed ? "red" : "slate"} />
          </section>

          {data.automations.readyNotEnabled > 0 ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <p className="font-semibold text-emerald-900">{data.automations.readyNotEnabled} automation(s) are READY but not active.</p>
              <Link href="/automations" className="mt-2 inline-block text-sm font-semibold text-emerald-800 underline">
                Go to Automations → Activate ready automations
              </Link>
            </Card>
          ) : null}

          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Action required ({data.actionRequired.length})</h2>
            {data.actionRequired.length === 0 ? (
              <Card>
                <p className="text-sm text-emerald-700">Nothing needs attention.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {data.actionRequired.map((a, i) => (
                  <Link key={`${a.label}-${i}`} href={a.link}>
                    <Card className="hover:border-brand-500">
                      <p className="text-sm font-semibold text-slate-900">{a.label}</p>
                      <p className="text-xs text-slate-500">{a.detail}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </ControlCenterLayout>
  );
}
