"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { WorkflowConfig } from "@/lib/types";

export default function AutomationsPage() {
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [activateResult, setActivateResult] = useState<{ activated: string[]; skipped: { key: string; reason: string }[] } | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setWorkflows(await api.get<WorkflowConfig[]>("/api/workflows"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    try {
      await api.post(`/api/workflows/${key}/${enabled ? "disable" : "enable"}`);
      await load();
    } catch (err) {
      alert(err instanceof APIError ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function activateReady() {
    setBusy("activate-ready");
    try {
      setActivateResult(await api.post("/api/workflows/activate-ready"));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function deactivateAll() {
    if (!confirm("Disable every currently-enabled automation?")) return;
    setBusy("deactivate-all");
    try {
      await api.post("/api/workflows/deactivate-all");
      await load();
    } finally {
      setBusy(null);
    }
  }

  const categories = Array.from(new Set(workflows.map((w) => w.category)));

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Automations"
        subtitle="Only workflows whose dependencies are all satisfied can be enabled — nothing here is activated because a button was clicked."
        action={
          <div className="flex gap-2">
            <Button onClick={activateReady} disabled={busy === "activate-ready"}>
              Activate ready automations
            </Button>
            <Button variant="secondary" onClick={deactivateAll} disabled={busy === "deactivate-all"}>
              Disable all
            </Button>
          </div>
        }
      />

      {activateResult ? (
        <Card className="mb-6">
          <p className="font-semibold text-emerald-700">Activated: {activateResult.activated.join(", ") || "none"}</p>
          {activateResult.skipped.length > 0 ? (
            <div className="mt-2 text-sm text-amber-700">
              Skipped: {activateResult.skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}
            </div>
          ) : null}
        </Card>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-8">
          {categories.map((category) => (
            <div key={category}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{category}</h2>
              <div className="space-y-3">
                {workflows
                  .filter((w) => w.category === category)
                  .map((w) => (
                    <Card key={w.key}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{w.name}</p>
                          <p className="text-xs text-slate-400">{w.key}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={w.enabled ? "green" : "slate"}>{w.enabled ? "Enabled" : "Disabled"}</Badge>
                          <Badge tone={statusTone(w.readiness)}>{w.readiness.replace(/_/g, " ")}</Badge>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {w.readinessDetail.map((d) => (
                          <span
                            key={d.requirement}
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${d.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
                            title={d.note}
                          >
                            {d.ok ? "✓" : "✕"} {d.label}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3">
                        <Button
                          variant={w.enabled ? "secondary" : "primary"}
                          disabled={busy === w.key || (!w.enabled && w.readiness !== "READY")}
                          onClick={() => toggle(w.key, w.enabled)}
                        >
                          {w.enabled ? "Disable" : "Enable"}
                        </Button>
                        {!w.n8nWorkflowId ? <span className="ml-3 text-xs text-slate-400">Not yet imported into n8n</span> : null}
                      </div>
                    </Card>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
