"use client";

import { useEffect, useState } from "react";
import { Card, ErrorState, LoadingState, Notice, inputClass, labelClass, formatDateTime } from "@/components/ui";
import { api, APIError } from "@/lib/api";

/**
 * Provider usage and cost. Known cost and unknown calls are shown side by side. An unknown call is
 * shown as "unknown" and never folded into a zero total.
 */
interface ProviderRow {
  provider: string;
  calls: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  mediaUnits: number;
  knownCost: Record<string, number>;
  unknownCalls: number;
  providerReportedCalls: number;
}
interface Summary {
  totals: { calls: number; failed: number; unknownCalls: number };
  providers: ProviderRow[];
}
interface UsageRecord {
  id: string;
  createdAt: string;
  provider: string;
  model: string | null;
  operation: string;
  workflowKey: string | null;
  attempt: number;
  status: string;
  inputTokens: number | null;
  outputTokens: number | null;
  mediaUnits: string | null;
  mediaUnitType: string | null;
  costAmount: string | null;
  currency: string;
  costSource: string;
  errorCode: string | null;
}
interface Price {
  id: string;
  provider: string;
  model: string | null;
  unit: string;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  note: string | null;
  createdBy: string;
}

const UNITS = ["input_token", "output_token", "second", "character", "credit", "request"];

function money(amount: number | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined) return "unknown";
  return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${currency}`;
}

export default function UsagePanel() {
  const [me, setMe] = useState<{ role: string } | null>(null);
  const canWrite = me?.role === "OWNER" || me?.role === "ADMIN";
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [provider, setProvider] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [error, setError] = useState("");
  const [priceForm, setPriceForm] = useState({ provider: "openai", model: "", unit: "input_token", unitPrice: "", currency: "USD", note: "" });
  const [priceMsg, setPriceMsg] = useState("");

  async function load() {
    try {
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const q = `from=${encodeURIComponent(from)}${provider ? `&provider=${encodeURIComponent(provider)}` : ""}`;
      const [s, r, p] = await Promise.all([
        api.get<Summary>(`/api/usage/summary?${q}`),
        api.get<{ records: UsageRecord[] }>(`/api/usage/records?${q}&limit=25`),
        api.get<{ prices: Price[] }>("/api/usage/prices"),
      ]);
      setSummary(s);
      setRecords(r.records);
      setPrices(p.prices);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Could not load usage");
    }
  }

  useEffect(() => {
    void api.get<{ role: string }>("/api/auth/me").then(setMe).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, provider]);

  async function savePrice() {
    setPriceMsg("");
    try {
      await api.post("/api/usage/prices", {
        provider: priceForm.provider.trim(),
        model: priceForm.model.trim() || null,
        unit: priceForm.unit,
        unitPrice: Number(priceForm.unitPrice),
        currency: priceForm.currency.toUpperCase(),
        note: priceForm.note.trim() || undefined,
      });
      setPriceMsg("Price saved. It applies to calls made from its effective date onward; earlier calls keep their recorded cost.");
      setPriceForm({ ...priceForm, unitPrice: "", note: "" });
      void load();
    } catch (err) {
      setPriceMsg(err instanceof APIError ? err.message : "Could not save the price");
    }
  }

  const providerOptions = summary?.providers.map((p) => p.provider) ?? [];

  return (
    <section className="mt-10 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Provider usage and cost</h2>
          <p className="text-sm text-slate-500">Recorded from each provider call. Calls without a price or usage data show as unknown, not zero.</p>
        </div>
        <div className="flex gap-2">
          <select className={inputClass.replace("mt-1 w-full", "")} value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <select className={inputClass.replace("mt-1 w-full", "")} value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
            <option value="">All providers</option>
            {providerOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!summary && !error ? <LoadingState label="Loading usage…" /> : null}

      {summary && summary.providers.length === 0 ? <Notice tone="blue">No provider calls recorded in this period.</Notice> : null}

      {summary && summary.providers.length > 0 ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Calls</th>
                <th className="py-2 pr-3">Failed</th>
                <th className="py-2 pr-3">Input tokens</th>
                <th className="py-2 pr-3">Output tokens</th>
                <th className="py-2 pr-3">Media units</th>
                <th className="py-2 pr-3">Known cost</th>
                <th className="py-2 pr-3">Unknown calls</th>
              </tr>
            </thead>
            <tbody>
              {summary.providers.map((p) => {
                const currencies = Object.entries(p.knownCost);
                return (
                  <tr key={p.provider} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-semibold text-slate-800">{p.provider}</td>
                    <td className="py-2 pr-3">{p.calls}</td>
                    <td className="py-2 pr-3">{p.failed}</td>
                    <td className="py-2 pr-3">{p.inputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3">{p.outputTokens.toLocaleString()}</td>
                    <td className="py-2 pr-3">{p.mediaUnits ? p.mediaUnits.toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3">{currencies.length === 0 ? (p.unknownCalls ? "unknown" : "—") : currencies.map(([c, v]) => money(v, c)).join(", ")}</td>
                    <td className={`py-2 pr-3 ${p.unknownCalls ? "font-semibold text-amber-700" : ""}`}>{p.unknownCalls}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Known cost adds only priced calls and provider-reported costs. Unknown calls are excluded from it, so the total is a floor, not a complete bill.
          </p>
        </Card>
      ) : null}

      {records.length > 0 ? (
        <Card className="overflow-x-auto">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Latest calls</h3>
          <table className="w-full text-left text-xs">
            <thead className="uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Provider / model</th>
                <th className="py-1 pr-3">Workflow</th>
                <th className="py-1 pr-3">Attempt</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Usage</th>
                <th className="py-1 pr-3">Cost</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="py-1 pr-3">{r.provider}{r.model ? ` / ${r.model}` : ""}</td>
                  <td className="py-1 pr-3">{r.workflowKey ?? "—"}</td>
                  <td className="py-1 pr-3">{r.attempt}</td>
                  <td className="py-1 pr-3">{r.status === "FAILED" ? `failed${r.errorCode ? ` (${r.errorCode})` : ""}` : "ok"}</td>
                  <td className="py-1 pr-3">
                    {r.inputTokens != null || r.outputTokens != null ? `${r.inputTokens ?? 0} in / ${r.outputTokens ?? 0} out` : r.mediaUnits ? `${Number(r.mediaUnits)} ${r.mediaUnitType}` : "no usage data"}
                  </td>
                  <td className="py-1 pr-3">{r.costSource === "UNKNOWN" ? "unknown" : money(r.costAmount ? Number(r.costAmount) : null, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Prices</h3>
        {prices.length === 0 ? (
          <p className="text-sm text-slate-500">No prices configured. Until a price is set, calls are recorded with unknown cost. Enter the provider&apos;s published rate below.</p>
        ) : (
          <ul className="space-y-1 text-xs text-slate-600">
            {prices.map((p) => (
              <li key={p.id}>
                {p.provider}
                {p.model ? ` / ${p.model}` : " (all models)"} · {p.unit} · {Number(p.unitPrice)} {p.currency} · from {formatDateTime(p.effectiveFrom)} · by {p.createdBy}
                {p.note ? ` · ${p.note}` : ""}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="mt-4 grid gap-3 md:grid-cols-6">
            <label className="md:col-span-1">
              <span className={labelClass}>Provider</span>
              <input className={inputClass} value={priceForm.provider} onChange={(e) => setPriceForm({ ...priceForm, provider: e.target.value })} />
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>Model (optional)</span>
              <input className={inputClass} value={priceForm.model} onChange={(e) => setPriceForm({ ...priceForm, model: e.target.value })} />
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>Unit</span>
              <select className={inputClass} value={priceForm.unit} onChange={(e) => setPriceForm({ ...priceForm, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>Price per unit</span>
              <input className={inputClass} inputMode="decimal" value={priceForm.unitPrice} onChange={(e) => setPriceForm({ ...priceForm, unitPrice: e.target.value })} />
            </label>
            <label className="md:col-span-1">
              <span className={labelClass}>Currency</span>
              <input className={inputClass} maxLength={3} value={priceForm.currency} onChange={(e) => setPriceForm({ ...priceForm, currency: e.target.value })} />
            </label>
            <div className="flex items-end">
              <button onClick={savePrice} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Save price
              </button>
            </div>
          </div>
        ) : null}
        {priceMsg ? <p className="mt-3 text-sm text-slate-700">{priceMsg}</p> : null}
      </Card>
    </section>
  );
}
