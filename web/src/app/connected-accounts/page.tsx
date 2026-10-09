"use client";

import { FormEvent, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Button, Card, ErrorState, LoadingState, Notice, PageHeader, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface ConnectedAccount {
  id: string;
  provider: string;
  label: string;
  externalAccountId: string;
  isDefault: boolean;
  status: string;
  connectedAt: string;
  maskedToken: string;
}

const PROVIDERS = [
  { key: "meta", label: "Meta (Instagram/Facebook)" },
  { key: "x", label: "X" },
  { key: "linkedin", label: "LinkedIn" },
];

function CaptureForm({ onCaptured }: { onCaptured: () => Promise<void> }) {
  const [provider, setProvider] = useState("meta");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/accounts/capture", { provider, label });
      setLabel("");
      await onCaptured();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div>
        <label className={labelClass}>Provider</label>
        <select className={inputClass} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Name this account</label>
        <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. @eki.vendors" required />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Capturing…" : "Capture current connection"}
      </Button>
      {error ? (
        <div className="basis-full">
          <Notice tone="red">{error}</Notice>
        </div>
      ) : null}
    </form>
  );
}

export default function ConnectedAccountsPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setAccounts(await api.get<ConnectedAccount[]>("/api/accounts"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const byProvider = (accounts ?? []).reduce<Record<string, ConnectedAccount[]>>((acc, a) => {
    (acc[a.provider] ??= []).push(a);
    return acc;
  }, {});

  return (
    <ControlCenterLayout>
      <PageHeader
        title="Connected Accounts"
        subtitle="One or more accounts per platform. First connect in Integrations the normal way, then capture that connection here with a name — repeat for each account."
      />
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!accounts ? (
        <LoadingState />
      ) : (
        <div className="space-y-6">
          <Card>
            <CaptureForm onCaptured={load} />
          </Card>
          {PROVIDERS.map((p) => (
            <section key={p.key}>
              <h2 className="mb-2 text-lg font-semibold text-slate-900">{p.label}</h2>
              <div className="space-y-2">
                {(byProvider[p.key] ?? []).map((a) => (
                  <Card key={a.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{a.label}</span>
                          {a.isDefault ? <Badge tone="blue">default</Badge> : null}
                          <Badge tone={a.status === "CONNECTED" ? "green" : "red"}>{a.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{a.externalAccountId} · token {a.maskedToken}</p>
                      </div>
                      <div className="flex gap-2">
                        {!a.isDefault ? (
                          <Button
                            variant="secondary"
                            onClick={async () => {
                              await api.post(`/api/accounts/${a.id}/default`);
                              await load();
                            }}
                          >
                            Make default
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          onClick={async () => {
                            await api.delete(`/api/accounts/${a.id}`);
                            await load();
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
                {(byProvider[p.key] ?? []).length === 0 ? <p className="text-sm text-slate-500">No account captured yet.</p> : null}
              </div>
            </section>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
