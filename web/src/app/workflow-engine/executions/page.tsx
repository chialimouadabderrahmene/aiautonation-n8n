"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Card, ErrorState, LoadingState, PageHeader, StatusBadge, formatDateTime } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import type { EngineExecutionSummary } from "@/lib/engine-types";

const STATUSES = ["QUEUED", "RUNNING", "WAITING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"];

function ExecutionsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "";
  const deadLetter = params.get("deadLetter") === "true";
  const [items, setItems] = useState<EngineExecutionSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const qs = new URLSearchParams({ limit: "100", ...(status ? { status } : {}), ...(deadLetter ? { deadLetter: "true" } : {}) });
      const res = await api.get<{ items: EngineExecutionSummary[] }>(`/api/engine/executions?${qs}`);
      setItems(res.items);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, deadLetter]);
  usePolling(load, 10_000);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (value) next.set(key, value); else next.delete(key);
    router.push(`/workflow-engine/executions?${next.toString()}`);
  };

  return (
    <ControlCenterLayout>
      <PageHeader title="Executions" subtitle="Every run of every native workflow, across all trigger types." />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm">
          <input type="checkbox" checked={deadLetter} onChange={(e) => setFilter("deadLetter", e.target.checked ? "true" : "")} /> Dead letter only
        </label>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !items ? <LoadingState /> : items.length === 0 ? (
        <Card>No executions match these filters.</Card>
      ) : (
        <div className="space-y-2">
          {items.map((e) => (
            <Link key={e.id} href={`/workflow-engine/executions/${e.id}`}>
              <Card className="transition hover:border-brand-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{e.workflow.name} <span className="text-xs font-normal text-slate-400">{e.triggerType}</span></p>
                    <p className="text-xs text-slate-500">{formatDateTime(e.startedAt)} · attempt {e.attempt}/{e.maxAttempts}{e.deadLetter ? " · DEAD LETTER" : ""}{e.error ? ` · ${e.error.slice(0, 80)}` : ""}</p>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}

export default function ExecutionsPage() {
  return <Suspense fallback={<ControlCenterLayout><LoadingState /></ControlCenterLayout>}><ExecutionsInner /></Suspense>;
}
