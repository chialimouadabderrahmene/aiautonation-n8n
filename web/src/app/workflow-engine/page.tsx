"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import type { EngineWorkflowSummary, QueueCounts } from "@/lib/engine-types";

/**
 * Workflow Engine dashboard — the native (non-n8n) runtime. Everything here reflects real
 * backend state: no mock records, no decorative counters.
 */
export default function WorkflowEnginePage() {
  const [workflows, setWorkflows] = useState<EngineWorkflowSummary[] | null>(null);
  const [queue, setQueue] = useState<{ triggerMatchQueue: QueueCounts; executionRunQueue: QueueCounts; deadLetterCount: number } | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [wf, q] = await Promise.all([
        api.get<EngineWorkflowSummary[]>("/api/engine/workflows"),
        api.get<{ triggerMatchQueue: QueueCounts; executionRunQueue: QueueCounts; deadLetterCount: number }>("/api/engine/queue/health"),
      ]);
      setWorkflows(wf);
      setQueue(q);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  };
  useEffect(() => { void load(); }, []);
  usePolling(load, 10_000);

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Workflow Engine"
        subtitle="Native, in-process automation runtime (BullMQ + Postgres) — no external workflow platform required to execute these."
        action={<Link href="/workflow-engine/executions" className="text-sm font-semibold text-brand-700 hover:underline">View all executions →</Link>}
      />

      {error ? <ErrorState message={error} onRetry={load} /> : !workflows || !queue ? <LoadingState /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Card><p className="text-xs font-semibold uppercase text-slate-400">Trigger queue</p><p className="mt-1 text-2xl font-bold">{queue.triggerMatchQueue.waiting + queue.triggerMatchQueue.active}</p><p className="text-xs text-slate-500">waiting/active</p></Card>
            <Card><p className="text-xs font-semibold uppercase text-slate-400">Execution queue</p><p className="mt-1 text-2xl font-bold">{queue.executionRunQueue.waiting + queue.executionRunQueue.active}</p><p className="text-xs text-slate-500">waiting/active · {queue.executionRunQueue.delayed} delayed</p></Card>
            <Card><p className="text-xs font-semibold uppercase text-slate-400">Dead letter</p><p className="mt-1 text-2xl font-bold">{queue.deadLetterCount}</p><Link href="/workflow-engine/executions?deadLetter=true" className="text-xs font-semibold text-brand-700 hover:underline">Review →</Link></Card>
            <Card><p className="text-xs font-semibold uppercase text-slate-400">Workflows enabled</p><p className="mt-1 text-2xl font-bold">{workflows.filter((w) => w.enabled).length}/{workflows.length}</p></Card>
          </div>

          <div className="space-y-3">
            {workflows.map((wf) => (
              <Link key={wf.id} href={`/workflow-engine/${wf.key}`}>
                <Card className="transition hover:border-brand-300">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{wf.name} <span className="text-xs font-normal text-slate-400">{wf.category} · {wf.triggerType}</span></p>
                      <p className="text-xs text-slate-500">
                        v{wf.currentVersion?.version ?? "—"} ({wf.currentVersion?.status ?? "no published version"})
                        {wf.schedule ? ` · next run ${timeAgo(wf.schedule.nextRunAt)}` : ""}
                        {wf.lastExecution ? ` · last run ${timeAgo(wf.lastExecution.startedAt)}` : " · never run"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {wf.lastExecution ? <StatusBadge status={wf.lastExecution.status} /> : null}
                      {wf.enabled ? <Badge tone="green">ENABLED</Badge> : <Badge tone="slate">DISABLED</Badge>}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </ControlCenterLayout>
  );
}
