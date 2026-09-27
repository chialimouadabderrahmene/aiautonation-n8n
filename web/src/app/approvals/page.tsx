"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Badge, Card, ErrorState, LoadingState, PageHeader, statusTone } from "@/components/ui";
import { api, APIError } from "@/lib/api";

interface ApprovalRow {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  telegramChatId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  videoJob: { id: string; state: string; project: { name: string } };
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await api.get<ApprovalRow[]>("/api/approvals"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ControlCenterLayout>
      <PageHeader title="Approvals" subtitle="Videos sent to Telegram for human review — approve/reject happens in Telegram; status lands back here." />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No videos have been sent for approval yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Link key={r.id} href={`/video/${r.videoJob.id}`}>
              <Card className="hover:border-brand-500">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{r.videoJob.project.name}</p>
                    <p className="text-xs text-slate-400">Sent {new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </div>
                {r.decidedBy ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Decided by {r.decidedBy} at {r.decidedAt ? new Date(r.decidedAt).toLocaleString() : "—"}
                  </p>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </ControlCenterLayout>
  );
}
