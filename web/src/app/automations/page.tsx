"use client";

import { useEffect, useMemo, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, Checklist, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { ComponentHealth, WorkflowConfig } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

interface ActivateResult {
  activated: string[];
  alreadyActive: string[];
  skipped: { key: string; name: string; reasons: string[] }[];
  summary: { activated: number; alreadyActive: number; skipped: number };
}

interface N8nStatus {
  health: ComponentHealth;
  lastReconcile: { at: string; imported: string[]; updated: string[]; failed: { key: string; error: string }[]; present: number; active: number } | null;
}

function WorkflowRow({ wf, onChanged }: { wf: WorkflowConfig; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "enable" | "disable" | "test">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(action: "enable" | "disable" | "test-run") {
    setBusy(action === "test-run" ? "test" : action);
    setMsg(null);
    try {
      const r = await api.post<{ ok?: boolean; message?: string }>(`/api/workflows/${wf.key}/${action}`);
      if (action === "test-run") setMsg({ ok: Boolean(r.ok), text: r.message ?? "" });
      else if (r.message) setMsg({ ok: true, text: r.message });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally {
      setBusy("");
      await onChanged();
    }
  }

  const failing = wf.readinessDetail.filter((d) => !d.ok);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button className="min-w-0 text-left" onClick={() => setOpen((v) => !v)}>
          <p className="font-bold text-slate-900">
            {wf.name} <span className="text-xs font-normal text-slate-400">{wf.key.slice(0, 2)} · {wf.category} · {wf.triggerKind === "manual" ? "scheduled" : wf.triggerKind}</span>
          </p>
          <p className="text-xs text-slate-500">
            {failing.length ? `${failing.length} blocker(s): ${failing[0]?.note ?? failing[0]?.label}${failing.length > 1 ? " …" : ""}` : "All requirements met"}
            {" · "}n8n: {wf.n8nPresent ? (wf.n8nActive ? "active" : "imported, inactive") : "not imported"}
            {wf.lastExecutionAt ? ` · last run ${timeAgo(wf.lastExecutionAt)} ${wf.lastExecutionOk ? "✓" : "✕"}` : ""}
          </p>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={wf.readiness} />
          {wf.enabled ? <Badge tone="green">ENABLED</Badge> : <Badge tone="slate">DISABLED</Badge>}
          {wf.enabled ? (
            <Button variant="secondary" onClick={() => void act("disable")} disabled={Boolean(busy)}>
              {busy === "disable" ? "…" : "Disable"}
            </Button>
          ) : (
            <Button onClick={() => void act("enable")} disabled={Boolean(busy) || wf.readiness !== "READY"}>
              {busy === "enable" ? "…" : "Enable"}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void act("test-run")} disabled={Boolean(busy) || !wf.n8nPresent || wf.triggerKind === "error"}>
            {busy === "test" ? "Running…" : wf.triggerKind === "webhook" ? "Test webhook" : "Test run"}
          </Button>
        </div>
      </div>
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice>
        </div>
      ) : wf.lastTestRunAt ? (
        <p className={`mt-2 text-xs ${wf.lastTestRunOk ? "text-emerald-700" : "text-red-700"}`}>
          Last test {timeAgo(wf.lastTestRunAt)}: {wf.lastTestRunMessage}
        </p>
      ) : null}
      {open ? (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <Checklist items={wf.readinessDetail} />
          {wf.triggerKind === "manual" ? (
            <p className="mt-3 text-xs text-slate-400">Test run executes the workflow for real in n8n (real messages, real sheet writes).</p>
          ) : wf.triggerKind === "webhook" ? (
            <p className="mt-3 text-xs text-slate-400">Webhook workflows are tested by checking the production webhook is live and rejects unauthenticated calls — no fake data is sent.</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export default function AutomationsPage() {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [n8n, setN8n] = useState<N8nStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<ActivateResult | null>(null);
  const [filter, setFilter] = useState<"all" | "READY" | "BLOCKED" | "enabled">("all");

  async function load() {
    try {
      const [w, s] = await Promise.all([api.get<WorkflowConfig[]>("/api/workflows"), api.get<N8nStatus>("/api/workflows/n8n-status")]);
      setWorkflows(w);
      setN8n(s);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 30_000);

  async function activateReady() {
    setBusy("activate");
    setResult(null);
    try {
      setResult(await api.post<ActivateResult>("/api/workflows/activate-ready"));
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Activation failed");
    } finally {
      setBusy("");
      await load();
    }
  }

  async function deactivateAll() {
    if (!confirm("Stop ALL automations now?")) return;
    setBusy("stop");
    await api.post("/api/workflows/deactivate-all").catch(() => undefined);
    setBusy("");
    await load();
  }

  async function sync() {
    setBusy("sync");
    try {
      await api.post("/api/workflows/sync");
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Sync failed");
    } finally {
      setBusy("");
      await load();
    }
  }

  const shown = useMemo(
    () => workflows.filter((w) => (filter === "all" ? true : filter === "enabled" ? w.enabled : w.readiness === filter)),
    [workflows, filter],
  );
  const ready = workflows.filter((w) => w.readiness === "READY").length;

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Automations"
        subtitle={`${workflows.length} workflows · ${ready} ready · ${workflows.filter((w) => w.enabled).length} enabled · ${workflows.filter((w) => w.n8nPresent).length} present in n8n`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={activateReady} disabled={Boolean(busy)}>
              {busy === "activate" ? "Activating…" : "Activate ready automations"}
            </Button>
            <Button variant="danger" onClick={deactivateAll} disabled={Boolean(busy)}>
              Stop all
            </Button>
          </div>
        }
      />

      {n8n ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <StatusBadge status={n8n.health.status} />
          <span>{n8n.health.message}</span>
          {n8n.lastReconcile ? <span>· last sync {timeAgo(n8n.lastReconcile.at)}</span> : null}
          <button onClick={sync} disabled={Boolean(busy)} className="font-semibold text-brand-600 underline">
            {busy === "sync" ? "Syncing…" : "Sync with n8n now"}
          </button>
        </div>
      ) : null}

      {result ? (
        <div className="mb-6">
          <Notice tone={result.summary.activated ? "green" : "amber"}>
            <p className="font-bold">
              Activated: {result.summary.activated} · Already active: {result.summary.alreadyActive} · Skipped: {result.summary.skipped}
            </p>
            {result.skipped.length ? (
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
                {result.skipped.map((s) => (
                  <li key={s.key}>
                    <span className="font-semibold">{s.name}</span>: {s.reasons.join("; ")}
                  </li>
                ))}
              </ul>
            ) : null}
            <button className="mt-2 text-xs underline" onClick={() => setResult(null)}>
              Dismiss
            </button>
          </Notice>
        </div>
      ) : null}

      <div className="mb-4 flex gap-2 text-sm">
        {(["all", "READY", "BLOCKED", "enabled"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f === "all" ? "All" : f === "enabled" ? "Enabled" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-3">
          {shown.map((wf) => (
            <WorkflowRow key={wf.key} wf={wf} onChanged={load} />
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
