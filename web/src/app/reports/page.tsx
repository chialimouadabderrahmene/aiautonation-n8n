"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Card, ErrorState, LoadingState, MetricTile, PageHeader } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface Report {
  period: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number | null;
  avgDurationMs: number | null;
  perWorkflow: { key: string; name: string; runs: number; success: number; failed: number }[];
  bySource: { source: string; runs: number; success: number; failed: number }[];
  daily: { date: string; success: number; failed: number }[];
  videosGenerated: number;
  videosFailed: number;
  videoFailedStages: Record<string, number>;
  avgVideoGenerationSec: number | null;
  approvalsPending: number;
  approvalsApproved: number;
  approvalsRejected: number;
  publicationsPublished: number;
  publicationsFailed: number;
}

const SOURCE_LABEL: Record<string, string> = { N8N: "n8n workflows", VIDEO_WORKER: "Video worker", CONTROL_CENTER: "Control Center" };

export default function ReportsPage() {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setData(await api.get<Report>(`/api/reports?period=${period}`));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load report");
    }
  }
  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.success + d.failed) ?? [1]));

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Reports"
        subtitle="Automation and content performance, computed from recorded executions."
        action={
          <div className="flex gap-1">
            {(["day", "week", "month"] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`rounded-full px-3 py-1 text-sm ${period === p ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {p === "day" ? "24 h" : p === "week" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        }
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!data ? (
        !error ? <LoadingState /> : null
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricTile label="Executions" value={data.totalExecutions} />
            <MetricTile label="Success rate" value={data.successRate === null ? "—" : `${data.successRate}%`} tone={data.successRate === null ? "slate" : data.successRate >= 90 ? "green" : "amber"} />
            <MetricTile label="Failed" value={data.failedExecutions} tone={data.failedExecutions ? "red" : "slate"} />
            <MetricTile label="Avg duration" value={data.avgDurationMs === null ? "—" : `${(data.avgDurationMs / 1000).toFixed(1)} s`} />
            <MetricTile label="Videos generated" value={data.videosGenerated} tone="green" />
            <MetricTile label="Videos failed" value={data.videosFailed} tone={data.videosFailed ? "red" : "slate"} />
            <MetricTile label="Approved / rejected" value={`${data.approvalsApproved} / ${data.approvalsRejected}`} />
            <MetricTile label="Published" value={`${data.publicationsPublished}${data.publicationsFailed ? ` (${data.publicationsFailed} failed)` : ""}`} tone="blue" />
          </div>

          <Card>
            <p className="font-bold text-slate-900">Runs per day</p>
            <div className="mt-4 flex h-40 items-end gap-1">
              {data.daily.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.success} ok, ${d.failed} failed`}>
                  <div className="flex w-full flex-col justify-end" style={{ height: "120px" }}>
                    <div className="w-full rounded-t bg-red-400" style={{ height: `${(d.failed / maxDaily) * 120}px` }} />
                    <div className="w-full bg-emerald-500" style={{ height: `${(d.success / maxDaily) * 120}px` }} />
                  </div>
                  <span className="text-[10px] text-slate-400">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Green = successful, red = failed.</p>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <p className="font-bold text-slate-900">By workflow</p>
              {data.perWorkflow.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No workflow runs in this period.</p>
              ) : (
                <table className="mt-3 w-full text-sm">
                  <tbody>
                    {data.perWorkflow.map((w) => (
                      <tr key={w.key} className="border-t border-slate-100">
                        <td className="py-2 text-slate-700">{w.name}</td>
                        <td className="py-2 text-right text-slate-500">{w.runs} runs</td>
                        <td className="py-2 text-right text-emerald-600">{w.success} ok</td>
                        <td className="py-2 text-right text-red-600">{w.failed} failed</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <p className="font-bold text-slate-900">By source</p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {data.bySource.map((s) => (
                    <tr key={s.source} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{SOURCE_LABEL[s.source] ?? s.source}</td>
                      <td className="py-2 text-right text-slate-500">{s.runs}</td>
                      <td className="py-2 text-right text-emerald-600">{s.success}</td>
                      <td className="py-2 text-right text-red-600">{s.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 font-bold text-slate-900">Video pipeline</p>
              <p className="mt-1 text-sm text-slate-500">Average generation time: {data.avgVideoGenerationSec === null ? "—" : `${Math.round(data.avgVideoGenerationSec / 60)} min`}</p>
              {Object.keys(data.videoFailedStages).length ? (
                <p className="mt-1 text-sm text-slate-500">
                  Failures by stage:{" "}
                  {Object.entries(data.videoFailedStages)
                    .map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()} ${v}`)
                    .join(", ")}
                </p>
              ) : null}
              <p className="mt-1 text-sm text-slate-500">Pending approvals: {data.approvalsPending}</p>
            </Card>
          </div>
        </div>
      )}
    </ControlCenterLayout>
  );
}
