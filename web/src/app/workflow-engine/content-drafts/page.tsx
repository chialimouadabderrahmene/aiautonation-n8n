"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, Notice, PageHeader, formatDateTime } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import type { EngineContentDraft } from "@/lib/engine-types";

const STATUSES = ["DRAFT", "QUEUED", "APPROVED", "REJECTED", "PUBLISHED"];

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "blue" | "slate"> = {
  DRAFT: "slate", QUEUED: "amber", APPROVED: "green", REJECTED: "red", PUBLISHED: "blue",
};

/**
 * Review queue for AI-generated content (content-multiplication-engine, social-proof-engine,
 * and any future content-calendar workflow) — the human-in-the-loop step n8n's Telegram
 * approval workflow (02) used to provide. Approve/reject here IS the review; there is no
 * native action yet that publishes an approved draft anywhere (see docs/WORKFLOW_ENGINE.md).
 */
function ContentDraftsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "";
  const [items, setItems] = useState<EngineContentDraft[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    try {
      const qs = new URLSearchParams(status ? { status } : {});
      const res = await api.get<EngineContentDraft[]>(`/api/engine/content-drafts?${qs}`);
      setItems(res);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load");
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);
  usePolling(load, 15_000);

  const setFilter = (value: string) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (value) next.set("status", value); else next.delete("status");
    router.push(`/workflow-engine/content-drafts?${next.toString()}`);
  };

  async function review(id: string, action: "approve" | "reject") {
    setBusy(id); setMsg(null);
    try {
      await api.post(`/api/engine/content-drafts/${id}/${action}`);
      setMsg({ ok: true, text: action === "approve" ? "Approved." : "Rejected." });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    } finally { setBusy(""); }
  }

  return (
    <ControlCenterLayout>
      <PageHeader title="Content Drafts" subtitle="AI-generated content from content-multiplication-engine and social-proof-engine, awaiting human review. Nothing here is auto-published." />
      {msg ? <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm" value={status} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !items ? <LoadingState /> : items.length === 0 ? (
        <Card>No content drafts match these filters.</Card>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <Card key={d.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{d.source}{d.platform ? ` · ${d.platform}` : ""}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{d.body}</p>
                  {d.hashtags.length ? <p className="mt-1 text-xs text-brand-600">{d.hashtags.join(" ")}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(d.createdAt)}{d.reviewedBy ? ` · reviewed by ${d.reviewedBy}` : ""}{d.reviewNote ? ` · "${d.reviewNote}"` : ""}</p>
                </div>
                <Badge tone={STATUS_TONE[d.status] ?? "slate"}>{d.status}</Badge>
              </div>
              {(d.status === "DRAFT" || d.status === "QUEUED") ? (
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => void review(d.id, "approve")} disabled={Boolean(busy)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300">Approve</button>
                  <button type="button" onClick={() => void review(d.id, "reject")} disabled={Boolean(busy)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">Reject</button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}

export default function ContentDraftsPage() {
  return <Suspense fallback={<ControlCenterLayout><LoadingState /></ControlCenterLayout>}><ContentDraftsInner /></Suspense>;
}
