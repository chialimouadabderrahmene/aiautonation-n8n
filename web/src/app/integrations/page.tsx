"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, Notice, PageHeader, StatusBadge, formatDateTime, inputClass, labelClass, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { Integration, IntegrationField } from "@/lib/types";

/**
 * Every card and form here is rendered from the provider schema the API
 * returns (fields, types, validation, auth type) — adding a provider on the
 * server adds it here with no UI change. Secrets are write-only: the browser
 * only ever receives a masked preview.
 */

const CATEGORY_LABELS: Record<string, string> = {
  AI: "AI",
  ORCHESTRATION: "Automation & data",
  MESSAGING: "Messaging",
  EMAIL: "Email",
  SOCIAL: "Social",
  RESEARCH: "Research",
  MEDIA: "Media",
};

function validateField(f: IntegrationField, value: string): string | null {
  if (!value) return null;
  if (f.type === "json") {
    try {
      JSON.parse(value);
    } catch {
      return "Must be valid JSON";
    }
  }
  if (f.type === "url" && !/^https?:\/\//.test(value)) return "Must start with http:// or https://";
  if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "Must be a valid email";
  if (f.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return "Must be a number";
  if (f.pattern && !new RegExp(f.pattern).test(value)) return f.patternMessage ?? "Invalid format";
  return null;
}

function FieldInput({ field, value, onChange, error }: { field: IntegrationField; value: string; onChange: (v: string) => void; error?: string | null }) {
  const placeholder = field.secret && field.maskedPreview ? `Stored: ${field.maskedPreview} — leave blank to keep` : field.placeholder ?? (field.default ? `Default: ${field.default}` : "");
  const common = { id: field.name, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value), placeholder, className: inputClass };
  return (
    <div>
      <label htmlFor={field.name} className={labelClass}>
        {field.label}
        {field.required ? <span className="text-red-500"> *</span> : null}
      </label>
      {field.type === "select" && field.options ? (
        <select {...common}>
          {!field.required ? <option value="">{field.default ? `Default (${field.default})` : "—"}</option> : null}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "json" || field.type === "textarea" ? (
        <textarea {...common} rows={field.secret ? 4 : 3} spellCheck={false} autoComplete="off" className={`${inputClass} font-mono text-xs`} />
      ) : (
        <input {...common} type={field.secret ? "password" : field.type === "number" ? "text" : "text"} autoComplete="off" spellCheck={false} />
      )}
      {field.help ? <p className="mt-1 text-xs text-slate-400">{field.help}</p> : null}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function IntegrationCard({ integration, onChanged }: { integration: Integration; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "save" | "test" | "oauth" | "remove">("");
  const [message, setMessage] = useState<{ tone: "green" | "red" | "amber" | "blue"; text: string } | null>(null);
  const [revealed, setRevealed] = useState<{ field: string; value: string } | null>(null);

  useEffect(() => {
    if (open) setValues(Object.fromEntries(integration.fields.filter((f) => !f.secret).map((f) => [f.name, integration.config[f.name] ?? ""])));
  }, [open, integration]);

  const groups = useMemo(() => {
    const g = new Map<string, IntegrationField[]>();
    for (const f of integration.fields) {
      const name = f.group ?? (integration.authType === "OAUTH" ? "OAuth app" : "Credentials");
      g.set(name, [...(g.get(name) ?? []), f]);
    }
    return [...g.entries()];
  }, [integration]);

  const errors = Object.fromEntries(integration.fields.map((f) => [f.name, validateField(f, (values[f.name] ?? "").trim())]));
  const hasErrors = Object.values(errors).some(Boolean);
  const isOAuth = integration.authType === "OAUTH";

  async function save(e: FormEvent) {
    e.preventDefault();
    if (hasErrors) return;
    setBusy("save");
    setMessage(null);
    const secrets: Record<string, string> = {};
    const config: Record<string, string> = {};
    for (const f of integration.fields) {
      const v = (values[f.name] ?? "").trim();
      if (f.secret) {
        if (v) secrets[f.name] = v;
      } else config[f.name] = v;
    }
    try {
      await api.put(`/api/integrations/${integration.provider}`, { secrets, config });
      setMessage({ tone: "blue", text: isOAuth ? "Saved. Now click “Connect account”." : "Saved and encrypted. Now click “Test connection”." });
      setOpen(false);
      await onChanged();
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof APIError ? err.message : "Save failed" });
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    try {
      const r = await api.post<{ ok: boolean; message: string; latencyMs: number }>(`/api/integrations/${integration.provider}/test`);
      setMessage({ tone: r.ok ? "green" : "red", text: `${r.ok ? "Connected" : "Test failed"}: ${r.message} (${r.latencyMs} ms)` });
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof APIError ? err.message : "Test failed" });
    } finally {
      setBusy("");
      await onChanged();
    }
  }

  async function connect() {
    setBusy("oauth");
    try {
      const { authorizeUrl } = await api.post<{ authorizeUrl: string }>(`/api/integrations/${integration.provider}/oauth/start`);
      window.location.href = authorizeUrl;
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof APIError ? err.message : "Could not start the connection" });
      setBusy("");
    }
  }

  async function disconnectAccount() {
    if (!confirm(`Disconnect the ${integration.label} account? Stored tokens are deleted.`)) return;
    setBusy("oauth");
    await api.post(`/api/integrations/${integration.provider}/oauth/disconnect`).catch(() => undefined);
    setBusy("");
    await onChanged();
  }

  async function remove() {
    if (!confirm(`Remove all ${integration.label} credentials? Automations that need it will be blocked.`)) return;
    setBusy("remove");
    await api.delete(`/api/integrations/${integration.provider}`).catch(() => undefined);
    setBusy("");
    await onChanged();
  }

  async function rotate(field: string) {
    if (!confirm("Generate a new secret? Anything using the old one stops working until you update it.")) return;
    try {
      const r = await api.post<{ value: string }>(`/api/integrations/${integration.provider}/secrets/${field}/rotate`);
      setRevealed({ field, value: r.value });
      await onChanged();
    } catch (err) {
      setMessage({ tone: "red", text: err instanceof APIError ? err.message : "Rotation failed" });
    }
  }

  const status = busy === "test" ? "TESTING" : integration.status;
  const canTest = integration.configured && (!isOAuth || integration.oauthConnected);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-900">{integration.label}</p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
              {integration.authType === "OAUTH" ? "OAuth" : integration.authType === "INFRA" ? "Automatic" : "API key"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">{integration.description}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
        {integration.connectedAccount ? (
          <div>
            <dt className="inline font-semibold">Account: </dt>
            <dd className="inline text-slate-700">{integration.connectedAccount}</dd>
          </div>
        ) : null}
        {integration.connectedAt ? (
          <div>
            <dt className="inline font-semibold">Connected: </dt>
            <dd className="inline">{formatDateTime(integration.connectedAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="inline font-semibold">Last verified: </dt>
          <dd className="inline">{integration.lastTestedAt ? `${timeAgo(integration.lastTestedAt)}${integration.lastTestLatencyMs ? ` · ${integration.lastTestLatencyMs} ms` : ""}` : "never"}</dd>
        </div>
        {integration.tokenExpiresAt ? (
          <div>
            <dt className="inline font-semibold">Token renews: </dt>
            <dd className="inline">automatically before {formatDateTime(integration.tokenExpiresAt)}</dd>
          </div>
        ) : null}
      </dl>
      {integration.lastTestMessage ? (
        <p className={`mt-2 text-xs ${integration.lastTestOk ? "text-emerald-700" : integration.lastTestOk === false ? "text-red-700" : "text-slate-500"}`}>{integration.lastTestMessage}</p>
      ) : null}
      {integration.caveat ? <p className="mt-2 text-xs text-amber-700">Note: {integration.caveat}</p> : null}

      {message ? (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      ) : null}
      {revealed ? (
        <div className="mt-3">
          <Notice tone="blue">
            <p className="font-semibold">New secret — copy it now, it will not be shown again:</p>
            <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs">{revealed.value}</code>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(revealed.value)}>
                Copy
              </Button>
              <Button variant="secondary" onClick={() => setRevealed(null)}>
                Done
              </Button>
            </div>
          </Notice>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={integration.configured ? "secondary" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : integration.configured ? "Edit" : "Configure"}
        </Button>
        {isOAuth ? (
          integration.oauthConnected ? (
            <Button variant="secondary" onClick={disconnectAccount} disabled={Boolean(busy)}>
              Disconnect account
            </Button>
          ) : (
            <Button onClick={connect} disabled={!integration.configured || Boolean(busy)}>
              {busy === "oauth" ? "Redirecting…" : "Connect account"}
            </Button>
          )
        ) : null}
        <Button variant={isOAuth || !integration.configured ? "secondary" : "primary"} onClick={test} disabled={!canTest || Boolean(busy)}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
        {integration.status !== "NOT_CONFIGURED" && integration.authType !== "INFRA" ? (
          <Button variant="danger" onClick={remove} disabled={Boolean(busy)}>
            Remove
          </Button>
        ) : null}
      </div>

      {open ? (
        <form onSubmit={save} className="mt-5 space-y-5 border-t border-slate-100 pt-5">
          {isOAuth ? (
            <Notice tone="blue">
              <p>
                1. Create an app in the provider&apos;s developer portal{integration.docsUrl ? (
                  <>
                    {" "}(
                    <a href={integration.docsUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                      open
                    </a>
                    )
                  </>
                ) : null}
                . 2. Register this redirect URL in it:
              </p>
              <code className="mt-1 block break-all rounded bg-white p-2 font-mono text-xs">{integration.oauthRedirectUri ?? "PUBLIC_WEB_URL is not set on the API service"}</code>
              <p className="mt-1">3. Paste the app credentials below, save, then click “Connect account”. Scopes requested: {integration.oauth?.scopes.join(", ")}</p>
            </Notice>
          ) : integration.docsUrl ? (
            <p className="text-xs text-slate-500">
              Where to get these:{" "}
              <a href={integration.docsUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 underline">
                {integration.docsUrl}
              </a>
            </p>
          ) : null}
          {groups.map(([group, fields]) => (
            <fieldset key={group} className="space-y-3">
              <legend className="mb-2 text-sm font-bold text-slate-700">{group}</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.name} className={f.type === "json" || f.type === "textarea" ? "md:col-span-2" : ""}>
                    <FieldInput field={f} value={values[f.name] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} error={errors[f.name]} />
                    {f.generatable && f.maskedPreview ? (
                      <button type="button" onClick={() => void rotate(f.name)} className="mt-1 text-xs font-semibold text-brand-600 underline">
                        Generate a new value (shown once)
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy === "save" || hasErrors}>
              {busy === "save" ? "Saving…" : "Save (encrypted)"}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [oauthBanner, setOauthBanner] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setError("");
    try {
      setItems(await api.get<Integration[]>("/api/integrations"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("oauth")) {
      setOauthBanner({ ok: q.get("result") === "ok", text: q.get("message") ?? "" });
      window.history.replaceState(null, "", "/integrations");
    }
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<string, Integration[]>();
    for (const i of items) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [items]);

  const connected = items.filter((i) => i.status === "CONNECTED").length;

  return (
    <ControlCenterLayout>
      <PageHeader title="Integrations" subtitle={`Enter or connect each provider, then test it. ${connected}/${items.length} connected. Keys are encrypted on the server and never shown again.`} />
      {oauthBanner ? (
        <div className="mb-4">
          <Notice tone={oauthBanner.ok ? "green" : "red"}>{oauthBanner.ok ? `Account connected. ${oauthBanner.text}` : `Connection failed: ${oauthBanner.text}`}</Notice>
        </div>
      ) : null}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-8">
          {byCategory.map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{CATEGORY_LABELS[category] ?? category}</h2>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {list.map((i) => (
                  <IntegrationCard key={i.provider} integration={i} onChanged={load} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
