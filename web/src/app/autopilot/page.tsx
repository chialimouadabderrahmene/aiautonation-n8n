"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, PageTitle, Switch } from "@/components/kit";
import { api, APIError } from "@/lib/api";
import { useHome } from "@/lib/home";

interface Autopilot {
  id: string; title: string; promise: string; when: string; steps: string[]; on: boolean; canRun: boolean;
  missing: { label: string; fix: string }[];
  workflows: { key: string; name: string; enabled: boolean }[];
  lastRun: { status: string; startedAt: string; error: string | null; id: string } | null;
  runsThisWeek: number; failedThisWeek: number;
}
interface RunStep { stepKey: string; status: string; output: unknown; error: string | null }
interface Run { id: string; status: string; name: string; error: string | null; steps: RunStep[] }

const STEP_WORDS: Record<string, string> = {
  SUCCEEDED: "Done", FAILED: "Failed", SKIPPED: "Not needed this time", RUNNING: "Working", PENDING: "Waiting",
};

const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/[-_]/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

function Card({ a, practice, onChange }: { a: Autopilot; practice: boolean; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");

  async function toggle(on: boolean) {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/autopilots/${a.id}/${on ? "on" : "off"}`);
      await onChange();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function tryNow() {
    setBusy(true);
    setError("");
    setRun(null);
    try {
      const { executionId } = await api.post<{ executionId: string }>(`/api/autopilots/${a.id}/run`);
      for (let i = 0; i < 40; i++) {
        const r = await api.get<Run>(`/api/autopilots/runs/${executionId}`);
        setRun(r);
        if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(r.status)) break;
        await new Promise((res) => setTimeout(res, 1000));
      }
      await onChange();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`flex flex-col rounded-3xl p-6 shadow-ticket transition ${a.on ? "bg-leaf text-paper" : "bg-card"}`}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-2xl font-bold leading-tight">{a.title}</h2>
        <Switch on={a.on} disabled={busy || (!a.canRun && !a.on)} onChange={(v) => void toggle(v)} label={a.title} />
      </div>
      <p className={`mt-2 ${a.on ? "text-paper/85" : "text-ink-soft"}`}>{a.promise}</p>
      <p className={`mt-3 text-sm font-semibold ${a.on ? "text-plantain" : "text-palm"}`}>{a.when}</p>

      <ol className="mt-4 flex-1 space-y-1.5">
        {a.steps.map((s, i) => (
          <li key={s} className={`flex gap-2.5 text-sm ${a.on ? "text-paper/80" : "text-ink-soft"}`}>
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${a.on ? "bg-paper/20" : "bg-slate-100"}`}>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      {a.missing.length ? (
        <div className="mt-4 rounded-2xl bg-plantain-wash p-3 text-sm text-ink">
          Needs {a.missing.map((m) => m.label).join(" and ")}. <Link href="/setup" className="font-semibold underline">Connect it</Link>
        </div>
      ) : null}
      {error ? <div className="mt-4 rounded-2xl bg-berry-wash p-3 text-sm text-berry">{error}</div> : null}

      {run ? (
        <div className={`rise mt-4 rounded-2xl p-3 text-sm ${a.on ? "bg-paper/10" : "bg-slate-100"}`}>
          <p className="font-semibold">{run.status === "SUCCEEDED" ? "It worked." : run.status === "FAILED" ? "It failed." : "Running..."}{practice ? " Nothing real was sent." : ""}</p>
          <ul className="mt-1.5 space-y-0.5">
            {run.steps.map((s) => (
              <li key={s.stepKey} className="flex justify-between gap-3">
                <span>{humanize(s.stepKey)}</span>
                <span className="opacity-70">{STEP_WORDS[s.status] ?? s.status}</span>
              </li>
            ))}
          </ul>
          {run.error ? <p className="mt-1 text-xs">{run.error}</p> : null}
        </div>
      ) : null}

      <div className={`mt-4 flex items-center justify-between gap-3 border-t border-dashed pt-3 text-xs ${a.on ? "border-paper/25 text-paper/70" : "border-rule text-ink-faint"}`}>
        <span>
          {a.lastRun ? `Last ran ${ago(a.lastRun.startedAt)}` : "Has not run yet"}
          {a.failedThisWeek ? `, ${a.failedThisWeek} failed this week` : ""}
        </span>
        <button onClick={() => void tryNow()} disabled={busy || !a.canRun} className="font-semibold underline underline-offset-2 disabled:opacity-40">Try it now</button>
      </div>
    </article>
  );
}

function Autopilots() {
  const { refresh } = useHome();
  const [state, setState] = useState<{ items: Autopilot[]; stopped: boolean; practice: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setState(await api.get("/api/autopilots")), []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStop(value: boolean) {
    setBusy(true);
    await api.put("/api/settings/autopilotStop", { value }).catch(() => undefined);
    await Promise.all([load(), refresh()]);
    setBusy(false);
  }

  if (!state) return <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  const onCount = state.items.filter((a) => a.on).length;

  return (
    <>
      <PageTitle
        title="Autopilot"
        sub={`Six jobs Eki can do on its own. Switch on what you want. ${onCount} ${onCount === 1 ? "is" : "are"} on right now.`}
        action={
          state.stopped
            ? <Btn tone="leaf" big disabled={busy} onClick={() => void setStop(false)}>Start everything again</Btn>
            : <Btn tone="danger" big disabled={busy} onClick={() => void setStop(true)}>Stop everything</Btn>
        }
      />
      {state.stopped ? <div className="mb-6"><Banner tone="berry"><strong>Everything is stopped.</strong> No messages or posts will go out until you start again.</Banner></div> : null}
      {state.practice ? <div className="mb-6"><Banner>You are practising, so these run for real but nothing leaves Eki. When you go live, they all switch off first so you can choose again.</Banner></div> : null}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {state.items.map((a) => <Card key={a.id} a={a} practice={state.practice} onChange={async () => { await Promise.all([load(), refresh()]); }} />)}
      </div>
      <p className="mt-8 text-sm text-ink-faint">Want the detail behind these? It is all in the <Link href="/workflow-engine" className="underline">back office</Link>.</p>
    </>
  );
}

export default function AutopilotPage() {
  return (
    <ControlCenterLayout>
      <Autopilots />
    </ControlCenterLayout>
  );
}
