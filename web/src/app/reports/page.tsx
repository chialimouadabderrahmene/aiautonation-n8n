"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { ErrorState, LoadingState, MetricTile, PageHeader } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface Report {
  period: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number | null;
  videosGenerated: number;
  videosFailed: number;
  approvalsPending: number;
  approvalsApproved: number;
  approvalsRejected: number;
}

const PERIODS = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState("week");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setReport(await api.get<Report>(`/api/reports?period=${period}`));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <ControlCenterLayout>
      <PageHeader title="Reports" subtitle="Automation and video generation metrics." />

      <div className="mb-6 flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${period === p.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : report ? (
        <div className="space-y-8">
          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Executions</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <MetricTile label="Total" value={report.totalExecutions} />
              <MetricTile label="Successful" value={report.successfulExecutions} tone="green" />
              <MetricTile label="Failed" value={report.failedExecutions} tone={report.failedExecutions > 0 ? "red" : "slate"} />
              <MetricTile label="Success rate" value={report.successRate !== null ? `${report.successRate}%` : "—"} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Video generation</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <MetricTile label="Videos generated" value={report.videosGenerated} tone="green" />
              <MetricTile label="Videos failed" value={report.videosFailed} tone={report.videosFailed > 0 ? "red" : "slate"} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">Approvals</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <MetricTile label="Pending" value={report.approvalsPending} tone="amber" />
              <MetricTile label="Approved" value={report.approvalsApproved} tone="green" />
              <MetricTile label="Rejected" value={report.approvalsRejected} tone="red" />
            </div>
          </div>
        </div>
      ) : null}
    </ControlCenterLayout>
  );
}
