"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, formatDateTime } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import type { EngineExecutionDetail } from "@/lib/engine-types";

const stepTone = (status: string) => (status === "SUCCEEDED" ? "green" : status === "FAILED" ? "red" : status === "SKIPPED" ? "slate" : "amber") as "green" | "red" | "slate" | "amber";

export default function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [execution, setExecution] = useState<EngineExecutionDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const e = await api.get<EngineExecutionDetail>(`/api/engine/executions/${id}`);
      setExecution(e);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function cancel() {
    if (!window.confirm("Cancel this execution? It stops at the next step boundary, never mid-action.")) return;
    setBusy("cancel"); setMsg(null);
    try { await api.post(`/api/engine/executions/${id}/cancel`); setMsg({ ok: true, text: "Cancelled." }); await load(); }
    catch (err) { setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" }); }
    finally { setBusy(""); }
  }

  async function replay() {
    if (!window.confirm("Replay this execution as a brand-new run with a fresh attempt budget?")) return;
    setBusy("replay"); setMsg(null);
    try {
      const r = await api.post<{ executionId: string }>(`/api/engine/executions/${id}/replay`);
      setMsg({ ok: true, text: `Replaying as ${r.executionId}.` });
      router.push(`/workflow-engine/executions/${r.executionId}`);
    } catch (err) { setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" }); }
    finally { setBusy(""); }
  }

  if (error) return <ControlCenterLayout><ErrorState message={error} onRetry={load} /></ControlCenterLayout>;
  if (!execution) return <ControlCenterLayout><LoadingState /></ControlCenterLayout>;

  const canCancel = ["QUEUED", "RUNNING", "WAITING", "RETRYING"].includes(execution.status);
  const canReplay = execution.deadLetter || execution.status === "FAILED";

  return (
    <ControlCenterLayout>
      <PageHeader
        title={`${execution.workflow.name} — execution`}
        subtitle={`${execution.triggerType} · v${execution.version.version} · started ${formatDateTime(execution.startedAt)}`}
        action={<div className="flex gap-2">
          {canCancel ? <Button variant="danger" onClick={() => void cancel()} disabled={Boolean(busy)}>Cancel</Button> : null}
          {canReplay ? <Button onClick={() => void replay()} disabled={Boolean(busy)}>Replay</Button> : null}
        </div>}
      />
      {msg ? <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={execution.status} />
        {execution.deadLetter ? <Badge tone="red">DEAD LETTER</Badge> : null}
        <span className="text-sm text-slate-500">attempt {execution.attempt}/{execution.maxAttempts}</span>
        {execution.requestedBy ? <span className="text-sm text-slate-500">· manually run by {execution.requestedBy}</span> : null}
        {execution.replayOfId ? <span className="text-sm text-slate-500">· replay of {execution.replayOfId}</span> : null}
      </div>
      {execution.error ? <Notice tone="red">{execution.error}</Notice> : null}

      <h2 className="mt-4 text-sm font-bold uppercase tracking-wide text-slate-500">Trigger payload</h2>
      <Card className="mt-2"><pre className="max-h-40 overflow-auto text-xs">{JSON.stringify(execution.triggerPayload, null, 2)}</pre></Card>

      <h2 className="mt-4 text-sm font-bold uppercase tracking-wide text-slate-500">Steps</h2>
      <div className="mt-2 space-y-2">
        {execution.steps.length === 0 ? <Card>No steps have run yet.</Card> : execution.steps.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{s.stepKey} <span className="text-xs font-normal text-slate-400">{s.type} · attempt {s.attempt}</span></p>
              <Badge tone={stepTone(s.status)}>{s.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">{formatDateTime(s.startedAt)}{s.durationMs != null ? ` · ${s.durationMs}ms` : ""}</p>
            {s.error ? <p className="mt-1 text-xs text-red-600">{s.error}</p> : null}
            <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Input / Output</summary>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(s.input, null, 2)}</pre>
                <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(s.output, null, 2)}</pre>
              </div>
            </details>
          </Card>
        ))}
      </div>

      <h2 className="mt-4 text-sm font-bold uppercase tracking-wide text-slate-500">Final context</h2>
      <Card className="mt-2"><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(execution.context, null, 2)}</pre></Card>
    </ControlCenterLayout>
  );
}
