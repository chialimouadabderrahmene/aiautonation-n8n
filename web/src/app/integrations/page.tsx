"use client";

import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { Integration } from "@/lib/types";

const CATEGORY_ORDER = ["AI", "ORCHESTRATION", "MESSAGING", "EMAIL", "SOCIAL", "RESEARCH", "MEDIA"];

function IntegrationCard({ integration, onChanged }: { integration: Integration; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const secrets: Record<string, string> = {};
      const config: Record<string, string> = {};
      for (const field of integration.fields) {
        const v = values[field.name];
        if (v === undefined || v === "") continue;
        if (field.secret) secrets[field.name] = v;
        else config[field.name] = v;
      }
      await api.put(`/api/integrations/${integration.provider}`, { secrets, config });
      setMessage("Saved. Run a connection test to confirm it works.");
      onChanged();
    } catch (err) {
      setMessage(err instanceof APIError ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMessage("");
    try {
      const result = await api.post<{ ok: boolean; message: string; latencyMs: number }>(`/api/integrations/${integration.provider}/test`);
      setMessage(result.ok ? `✓ Connected (${result.latencyMs}ms)` : `✕ ${result.message}`);
      onChanged();
    } catch (err) {
      setMessage(err instanceof APIError ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${integration.label}? This removes the stored credentials.`)) return;
    await api.delete(`/api/integrations/${integration.provider}`);
    onChanged();
  }

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-slate-900">{integration.label}</p>
          <p className="text-sm text-slate-500">{integration.description}</p>
        </div>
        <Badge tone={statusTone(integration.status)}>{integration.status.replace(/_/g, " ")}</Badge>
      </div>

      {integration.caveat ? <p className="mt-2 text-xs italic text-amber-700">{integration.caveat}</p> : null}

      {integration.lastTestedAt ? (
        <p className="mt-3 text-xs text-slate-400">
          Last checked {new Date(integration.lastTestedAt).toLocaleString()} — {integration.lastTestOk ? "✓ ok" : `✕ ${integration.lastTestMessage}`}
        </p>
      ) : (
        <p className="mt-3 text-xs text-slate-400">Never tested</p>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Configure"}
        </Button>
        <Button variant="secondary" onClick={test} disabled={testing || integration.status === "NOT_CONFIGURED"}>
          {testing ? "Testing..." : "Test connection"}
        </Button>
        {integration.status !== "NOT_CONFIGURED" ? (
          <Button variant="danger" onClick={disconnect}>
            Disconnect
          </Button>
        ) : null}
      </div>

      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}

      {open ? (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          {integration.fields.map((field) => (
            <div key={field.name}>
              <label className="block text-xs font-semibold uppercase text-slate-500">
                {field.label} {field.required ? "*" : ""}
              </label>
              <input
                type={field.secret ? "password" : "text"}
                placeholder={field.secret ? field.maskedPreview ?? "" : field.default ?? ""}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </div>
          ))}
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save credentials"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setIntegrations(await api.get<Integration[]>("/api/integrations"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader title="Integrations" subtitle="Configure → Test → Ready. Secrets are encrypted server-side and never shown again after saving." />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.map((category) => {
            const items = integrations.filter((i) => i.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{category}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((integration) => (
                    <IntegrationCard key={integration.provider} integration={integration} onChanged={load} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ControlCenterLayout>
  );
}
