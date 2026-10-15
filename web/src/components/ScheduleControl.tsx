"use client";

import { useState } from "react";
import { Button, Notice, StatusBadge, inputClass, labelClass } from "@/components/ui";
import { api, APIError } from "@/lib/api";

export interface ScheduledRow {
  target: string;
  status: string;
  scheduledFor: string | null;
  scheduleTimezone: string | null;
  error: string | null;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local wall-clock value for <input type="datetime-local"> — the browser's own zone, one minute ahead. */
function defaultLocalValue(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatInZone(iso: string, zone: string | null): string {
  try {
    return new Date(iso).toLocaleString("en-GB", { timeZone: zone ?? undefined, dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

/** Schedules every publish destination of this item for one instant. Scheduling never sends
 * anything: approval, the emergency stop and the content state are re-checked at publish time. */
export default function ScheduleControl({ endpointBase, rows, onChanged }: { endpointBase: string; rows: ScheduledRow[]; onChanged: () => Promise<void> }) {
  const [when, setWhen] = useState(defaultLocalValue);
  const [busy, setBusy] = useState<"" | "schedule" | "cancel">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zone = browserTimezone();
  const scheduled = rows.filter((r) => r.status === "SCHEDULED");

  async function schedule() {
    setBusy("schedule");
    setMsg(null);
    try {
      const instant = new Date(when);
      if (Number.isNaN(instant.getTime())) throw new Error("Pick a valid date and time");
      const res = await api.post<{ scheduled: unknown[]; refused: { target: string; reason: string }[] }>(`${endpointBase}/schedule`, {
        scheduledFor: instant.toISOString(),
        timezone: zone,
      });
      const refused = res.refused?.length ? ` Not scheduled: ${res.refused.map((r) => `${r.target} (${r.reason})`).join(", ")}.` : "";
      setMsg({ ok: true, text: `Scheduled for ${formatInZone(instant.toISOString(), zone)} (${zone}).${refused}` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : err instanceof Error ? err.message : "Could not schedule" });
    } finally {
      setBusy("");
      await onChanged();
    }
  }

  async function cancel() {
    setBusy("cancel");
    setMsg(null);
    try {
      await api.post(`${endpointBase}/schedule/cancel`);
      setMsg({ ok: true, text: "Scheduled publishing cancelled." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Could not cancel" });
    } finally {
      setBusy("");
      await onChanged();
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-200 p-4">
      <p className="font-bold text-slate-900">Schedule publishing</p>
      <p className="mt-1 text-xs text-slate-500">
        Times are entered in your timezone ({zone}). Approval is checked again at the scheduled time, and nothing is sent while the emergency stop is on.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className={labelClass} htmlFor="schedule-at">Publish at</label>
          <input id="schedule-at" type="datetime-local" className={inputClass} value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <Button onClick={() => void schedule()} disabled={Boolean(busy) || !when}>
          {busy === "schedule" ? "Scheduling…" : "Schedule"}
        </Button>
        {scheduled.length ? (
          <Button variant="danger" onClick={() => void cancel()} disabled={Boolean(busy)}>
            {busy === "cancel" ? "Cancelling…" : "Cancel schedule"}
          </Button>
        ) : null}
      </div>
      {msg ? (
        <div className="mt-3">
          <Notice tone={msg.ok ? "green" : "red"}>{msg.text}</Notice>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="mt-4 space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.target} className="flex flex-wrap items-center justify-between gap-2">
              <span className="capitalize text-slate-700">{r.target}</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {r.scheduledFor ? `${formatInZone(r.scheduledFor, r.scheduleTimezone)} (${r.scheduleTimezone ?? "UTC"})` : null}
                <StatusBadge status={r.status} />
              </span>
              {r.error ? <span className="w-full text-xs text-red-700">{r.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
