import { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-100 text-blue-700",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}>{children}</span>;
}

export function statusTone(status: string): keyof typeof badgeTones {
  if (["CONNECTED", "READY", "SUCCESS", "APPROVED"].includes(status)) return "green";
  if (["TEST_FAILED", "BLOCKED", "FAILED", "REJECTED"].includes(status)) return "red";
  if (["ACTION_REQUIRED", "CONFIGURED", "PENDING", "RUNNING"].includes(status)) return "amber";
  if (["CANCELLED"].includes(status)) return "slate";
  return "blue";
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles: Record<string, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="flex items-center justify-center py-16 text-sm text-slate-400">{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
      {onRetry ? (
        <button onClick={onRetry} className="ml-3 font-semibold underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
      <p className="font-semibold text-slate-600">{title}</p>
      {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

export function MetricTile({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: keyof typeof badgeTones }) {
  const toneText: Record<string, string> = { green: "text-emerald-600", amber: "text-amber-600", red: "text-red-600", slate: "text-slate-900", blue: "text-blue-600" };
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${toneText[tone]}`}>{value}</p>
    </Card>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: "Not configured",
  CONFIGURED: "Configured",
  TEST_FAILED: "Test failed",
  CONNECTED: "Connected",
  ACTION_REQUIRED: "Action required",
  TESTING: "Testing…",
  ONLINE: "Online",
  OFFLINE: "Offline",
  DEGRADED: "Degraded",
  READY: "Ready",
  BLOCKED: "Blocked",
};

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "TESTING" ? "blue" : status === "ONLINE" ? "green" : status === "OFFLINE" ? "red" : status === "DEGRADED" ? "amber" : status === "NOT_CONFIGURED" ? "slate" : statusTone(status);
  return <Badge tone={tone}>{STATUS_LABELS[status] ?? status.replace(/_/g, " ")}</Badge>;
}

export function Checklist({ items }: { items: { label: string; ok: boolean; note?: string }[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((d, i) => (
        <li key={`${d.label}-${i}`} className="flex gap-2">
          <span className={d.ok ? "text-emerald-600" : "text-red-600"}>{d.ok ? "✓" : "✕"}</span>
          <span className={d.ok ? "text-slate-700" : "text-slate-900"}>
            {d.label}
            {!d.ok && d.note ? <span className="block text-xs text-slate-500">{d.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const inputClass = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500";
export const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500";

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "green" | "blue"; children: ReactNode }) {
  const styles = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };
  return <div className={`rounded-xl border p-4 text-sm ${styles[tone]}`}>{children}</div>;
}
