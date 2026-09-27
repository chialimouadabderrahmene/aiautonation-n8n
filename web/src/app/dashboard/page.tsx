"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, MetricTile, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { DashboardSummary } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await api.get<DashboardSummary>("/api/dashboard"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load dashboard");
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
        title="AI Automation Dashboard"
        subtitle="Live status only — nothing here is shown as connected until it has actually been tested."
      />
      {loading ? (
        <LoadingState label="Loading system status..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : data ? (
        <div className="space-y-8">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400">System</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {data.system === "READY" ? "READY" : data.system === "PARTIALLY_READY" ? "PARTIALLY READY" : "BLOCKED"}
                </p>
              </div>
              <Badge tone={statusTone(data.n8nStatus)}>n8n: {data.n8nStatus.replace(/_/g, " ")}</Badge>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricTile label="Integrations connected" value={`${data.integrations.connected} / ${data.integrations.total}`} tone={data.integrations.connected > 0 ? "green" : "slate"} />
            <MetricTile label="Automations enabled" value={`${data.automations.enabled} / ${data.automations.enabled + data.automations.disabled}`} />
            <MetricTile label="Videos completed" value={data.video.completed} tone="green" />
            <MetricTile label="Videos failed" value={data.video.failed} tone={data.video.failed > 0 ? "red" : "slate"} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <MetricTile label="Today's executions" value={data.today.executions} />
            <MetricTile label="Successful today" value={data.today.successful} tone="green" />
            <MetricTile label="Failed today" value={data.today.failed} tone={data.today.failed > 0 ? "red" : "slate"} />
          </div>

          <Card>
            <h2 className="text-lg font-bold text-slate-900">Action required</h2>
            {data.actionRequired.length === 0 ? (
              <p className="mt-3 text-sm text-emerald-600">Nothing blocking right now.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.actionRequired.map((item, i) => (
                  <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                    <span className="font-semibold text-amber-800">{item.label}</span>
                    <span className="ml-2 text-amber-700">{item.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </ControlCenterLayout>
  );
}
