"use client";

import { Fragment, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, formatDateTime, inputClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { AutomationExecution } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const SOURCE_LABEL: Record<string, string> = { N8N: "n8n workflow", VIDEO_WORKER: "Video worker", CONTROL_CENTER: "Control Center" };

function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

export default function ExecutionsPage() {
  const [items, setItems] = useState<AutomationExecution[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load(cursor?: string) {
    try {
      const q = new URLSearchParams({ limit: "50", ...(status ? { status } : {}), ...(source ? { source } : {}), ...(cursor ? { cursor } : {}) });
      const r = await api.get<{ items: AutomationExecution[]; nextCursor: string | null }>(`/api/executions?${q.toString()}`);
      setItems((prev) => (cursor ? [...prev, ...r.items] : r.items));
      setNextCursor(r.nextCursor);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load executions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source]);
  usePolling(() => load(), 15_000);

  return (
    <ControlCenterLayout>
      <PageHeader title="Executions" subtitle="Every automation run — n8n workflows, video generation, Telegram sends and publishing — in one list." />
      <div className="mb-4 flex flex-wrap gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className={`${inputClass} w-auto`}>
          <option value="">All sources</option>
          <option value="N8N">n8n workflows</option>
          <option value="VIDEO_WORKER">Video worker</option>
        </select>
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : items.length === 0 ? (
        <EmptyState title="No executions yet" subtitle="Runs appear here as soon as an automation or video job starts." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Workflow / job</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Retries</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <Fragment key={e.id}>
                  <tr className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{e.workflowConfig?.name ?? (e.relatedEntityType === "VideoJob" ? "Video job" : e.relatedEntityId ?? "—")}</p>
                      <p className="text-xs text-slate-400">
                        {SOURCE_LABEL[e.source]}
                        {e.provider ? ` · ${e.provider}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{e.trigger ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(e.startedAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{duration(e.durationMs)}</td>
                    <td className="px-4 py-3 text-slate-600">{e.retryCount}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={e.status} />
                    </td>
                  </tr>
                  {expanded === e.id ? (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-3 text-xs text-slate-600">
                        <p>
                          Finished: {formatDateTime(e.finishedAt)} · External id: {e.externalId ?? "—"} · Related: {e.relatedEntityType ?? "—"} {e.relatedEntityId ?? ""}
                          {e.mode ? ` · Stage/mode: ${e.mode}` : ""}
                        </p>
                        {e.error ? <p className="mt-1 text-red-700">Error: {e.error}</p> : null}
                        {e.relatedEntityType === "VideoJob" && e.relatedEntityId ? (
                          <a href={`/video/${e.relatedEntityId}`} className="mt-1 inline-block font-semibold text-brand-600 underline">
                            Open video
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {nextCursor ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void load(nextCursor)}>
            Load more
          </Button>
        </div>
      ) : null}
    </ControlCenterLayout>
  );
}
