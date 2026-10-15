"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { AutomationExecution } from "@/lib/types";

const STATUS_FILTERS = ["ALL", "SUCCESS", "FAILED", "RUNNING", "CANCELLED"] as const;

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AutomationExecution | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const query = filter === "ALL" ? "" : `?status=${filter}`;
      setExecutions(await api.get<AutomationExecution[]>(`/api/executions${query}`));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load executions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <ControlCenterLayout>
      <PageHeader title="Execution Logs" subtitle="Every n8n workflow run and video-worker job, in one timeline." />

      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${filter === s ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : executions.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No executions recorded yet.</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Workflow</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Provider</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => (
                <tr key={e.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setSelected(e)}>
                  <td className="px-4 py-3 text-slate-500">{new Date(e.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">{e.source.replace("_", " ")}</td>
                  <td className="px-4 py-3">{e.workflowConfig?.name ?? e.trigger ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{e.provider ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelected(null)}>
          <Card className="max-w-lg" >
            <div onClick={(e) => e.stopPropagation()}>
              <p className="font-bold">{selected.workflowConfig?.name ?? selected.trigger ?? selected.source}</p>
              <p className="mt-1 text-xs text-slate-400">{selected.id}</p>
              <p className="mt-3 text-sm">Status: <Badge tone={statusTone(selected.status)}>{selected.status}</Badge></p>
              <p className="mt-1 text-sm text-slate-600">Started: {new Date(selected.startedAt).toLocaleString()}</p>
              {selected.finishedAt ? <p className="text-sm text-slate-600">Finished: {new Date(selected.finishedAt).toLocaleString()}</p> : null}
              <p className="text-sm text-slate-600">Retries: {selected.retryCount}</p>
              {selected.error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{selected.error}</p> : null}
            </div>
          </Card>
        </div>
      ) : null}
    </ControlCenterLayout>
  );
}
