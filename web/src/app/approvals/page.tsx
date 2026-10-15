"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { Approval, Publication, VideoProject } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

type ApprovalRow = Approval & { videoJob: { id: string; state: string; project: VideoProject; publications: Publication[] } };

export default function ApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("PENDING");

  async function load() {
    try {
      setRows(await api.get<ApprovalRow[]>("/api/approvals"));
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  usePolling(load, 10_000);

  const shown = rows.filter((r) => filter === "ALL" || r.status === filter);

  return (
    <ControlCenterLayout>
      <PageHeader title="Approvals" subtitle="Finished videos go to your Telegram team chat with APPROVE / REJECT buttons. Decisions made there appear here automatically." />
      <div className="mb-4 flex gap-2 text-sm">
        {(["PENDING", "APPROVED", "REJECTED", "ALL"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {f.charAt(0) + f.slice(1).toLowerCase()} ({f === "ALL" ? rows.length : rows.filter((r) => r.status === f).length})
          </button>
        ))}
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing here" subtitle="Videos appear once they are READY and sent for approval." />
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <Link key={a.id} href={`/video/${a.videoJob.id}`}>
              <Card className="hover:border-brand-500">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-900">{a.videoJob.project.name}</p>
                    <p className="text-xs text-slate-500">
                      {a.channel} · sent {timeAgo(a.createdAt)}
                      {a.decidedBy ? ` · decided by ${a.decidedBy} ${timeAgo(a.decidedAt)}` : ""}
                    </p>
                    {a.note ? <p className="text-xs text-slate-500">{a.note}</p> : null}
                    {a.rejectionReason ? <p className="text-xs text-red-700">{a.rejectionReason}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.videoJob.publications.map((p) => (
                      <span key={p.id} className="text-xs text-slate-500">
                        {p.target}: <StatusBadge status={p.status} />
                      </span>
                    ))}
                    <StatusBadge status={a.status} />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
