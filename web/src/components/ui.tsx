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
