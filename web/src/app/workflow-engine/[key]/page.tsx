"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, formatDateTime, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import type { EngineExecutionSummary, EngineWorkflowDetail } from "@/lib/engine-types";

/**
 * Workflow detail: version history (each one immutable once published), publish/rollback,
 * enable/disable, a manual test-run (executes real actions — never pretend otherwise), and
 * this workflow's recent executions. Definitions are edited as JSON — there is no visual
 * drag-and-drop builder in this release (see docs/WORKFLOW_ENGINE.md).
 */
export default function WorkflowDetailPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const [wf, setWf] = useState<EngineWorkflowDetail | null>(null);
  const [executions, setExecutions] = useState<EngineExecutionSummary[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newDefinition, setNewDefinition] = useState("");
  const [testPayload, setTestPayload] = useState("{}");

  const load = async () => {
    try {
      const [w, execs] = await Promise.all([
        api.get<EngineWorkflowDetail>(`/api/engine/workflows/${key}`),
        api.get<{ items: EngineExecutionSummary[] }>(`/api/engine/executions?workflowKey=${key}&limit=10`),
      ]);
      setWf(w);
      setExecutions(execs.items);
      if (!newDefinition) {
        const current = w.versions.find((v) => v.id === w.currentVersionId);
        setNewDefinition(JSON.stringify(current?.definition ?? w.versions[0]?.definition ?? { steps: [] }, null, 2));
      }
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  async function act(action: "enable" | "disable", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action); setMsg(null);
    try {
      await api.post(`/api/engine/workflows/${key}/${action}`);
      setMsg({ ok: true, text: `${action === "enable" ? "Enabled" : "Disabled"}.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  async function createDraft() {
    setBusy("draft"); setMsg(null);
    try {
      const definition = JSON.parse(newDefinition);
      const version = await api.post<{ version: number }>(`/api/engine/workflows/${key}/versions`, { definition });
      setMsg({ ok: true, text: `Draft v${version.version} created.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  async function publish(version: number) {
    if (!window.confirm(`Publish version ${version}? It becomes immutable and live immediately for new triggers.`)) return;
    setBusy(`publish-${version}`); setMsg(null);
    try {
      await api.post(`/api/engine/workflows/${key}/versions/${version}/publish`);
      setMsg({ ok: true, text: `Published v${version}.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  async function rollback(version: number) {
    if (!window.confirm(`Roll back to version ${version}? New triggers will run against it immediately; in-flight executions are unaffected.`)) return;
    setBusy(`rollback-${version}`); setMsg(null);
    try {
      await api.post(`/api/engine/workflows/${key}/versions/${version}/rollback`);
      setMsg({ ok: true, text: `Rolled back to v${version}.` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  async function testRun() {
    setBusy("test"); setMsg(null);
    try {
      const payload = JSON.parse(testPayload);
      const result = await api.post<{ executionId: string }>(`/api/engine/workflows/${key}/test-run`, { payload });
      setMsg({ ok: true, text: `Queued execution ${result.executionId} — this runs real actions.` });
      router.push(`/workflow-engine/executions/${result.executionId}`);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  if (error) return <ControlCenterLayout><ErrorState message={error} onRetry={load} /></ControlCenterLayout>;
  if (!wf || !executions) return <ControlCenterLayout><LoadingState /></ControlCenterLayout>;

  return (
    <ControlCenterLayout>
      <PageHeader
        title={wf.name}
        subtitle={wf.description ?? undefined}
        action={<div className="flex items-center gap-2">
          {wf.enabled ? <Badge tone="green">ENABLED</Badge> : <Badge tone="slate">DISABLED</Badge>}
          {wf.enabled
            ? <Button variant="secondary" onClick={() => void act("disable")} disabled={Boolean(busy)}>Disable</Button>
            : <Button onClick={() => void act("enable")} disabled={Boolean(busy)}>Enable</Button>}
        </div>}
      />
      {msg ? <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice> : null}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><p className={labelClass}>Trigger</p><p className="mt-1 text-sm font-semibold">{wf.triggerType}</p><p className="text-xs text-slate-500">{JSON.stringify(wf.triggerConfig)}</p></Card>
        <Card><p className={labelClass}>Category</p><p className="mt-1 text-sm font-semibold">{wf.category}</p></Card>
        <Card><p className={labelClass}>Current version</p><p className="mt-1 text-sm font-semibold">{wf.currentVersion ? `v${wf.currentVersion.version} (${wf.currentVersion.status})` : "none"}</p></Card>
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Version history</h2>
      <div className="mt-2 space-y-2">
        {wf.versions.map((v) => (
          <Card key={v.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">v{v.version} <Badge tone={v.status === "PUBLISHED" ? "green" : v.status === "DRAFT" ? "amber" : "slate"}>{v.status}</Badge> {wf.currentVersionId === v.id ? <Badge tone="blue">CURRENT</Badge> : null}</p>
                <p className="text-xs text-slate-500">by {v.createdBy} · {formatDateTime(v.createdAt)}{v.publishedAt ? ` · published ${formatDateTime(v.publishedAt)} by ${v.publishedBy}` : ""}</p>
                {v.notes ? <p className="text-xs text-slate-500">{v.notes}</p> : null}
              </div>
              <div className="flex gap-2">
                {v.status === "DRAFT" ? <Button onClick={() => void publish(v.version)} disabled={Boolean(busy)}>Publish</Button> : null}
                {v.status === "PUBLISHED" && wf.currentVersionId !== v.id ? <Button variant="secondary" onClick={() => void rollback(v.version)} disabled={Boolean(busy)}>Roll back to this</Button> : null}
              </div>
            </div>
            <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Definition JSON</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(v.definition, null, 2)}</pre>
            </details>
          </Card>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">New draft version</h2>
      <Card className="mt-2">
        <label className={labelClass}>Definition JSON</label>
        <textarea className={`${inputClass} h-64 font-mono text-xs`} value={newDefinition} onChange={(e) => setNewDefinition(e.target.value)} />
        <div className="mt-3"><Button onClick={() => void createDraft()} disabled={Boolean(busy)}>Save as new draft</Button></div>
      </Card>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Manual test run</h2>
      <Card className="mt-2">
        <p className="text-xs text-slate-500">Executes the CURRENT published version with this sample trigger payload. This is a real execution, not a simulation.</p>
        <label className={`${labelClass} mt-2`}>Sample trigger payload (JSON)</label>
        <textarea className={`${inputClass} h-24 font-mono text-xs`} value={testPayload} onChange={(e) => setTestPayload(e.target.value)} />
        <div className="mt-3"><Button onClick={() => void testRun()} disabled={Boolean(busy) || !wf.currentVersion}>Run test</Button></div>
      </Card>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Recent executions</h2>
      <div className="mt-2 space-y-2">
        {executions.length === 0 ? <Card>No executions yet.</Card> : executions.map((e) => (
          <Link key={e.id} href={`/workflow-engine/executions/${e.id}`}>
            <Card className="transition hover:border-brand-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">{formatDateTime(e.startedAt)} · attempt {e.attempt}/{e.maxAttempts}{e.deadLetter ? " · DEAD LETTER" : ""}</p>
                <StatusBadge status={e.status} />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </ControlCenterLayout>
  );
}
