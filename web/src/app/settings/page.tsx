"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Button, Card, ErrorState, LoadingState, Notice, PageHeader, formatBytes, inputClass, labelClass, timeAgo } from "@/components/ui";
import { api, APIError } from "@/lib/api";
import { MediaFile, SettingDefinition } from "@/lib/types";

function SettingRow({ def, value, onSaved }: { def: SettingDefinition; value: unknown; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<string | number | boolean>(value as string | number | boolean);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setDraft(value as string | number | boolean), [value]);
  const dirty = draft !== value;

  async function save(v: string | number | boolean = draft) {
    setState(null);
    try {
      const r = await api.put<{ appliesToN8n: boolean }>(`/api/settings/${def.key}`, { value: v });
      setState({ ok: true, text: r.appliesToN8n ? "Saved — n8n picks it up automatically within a minute" : "Saved" });
      await onSaved();
    } catch (err) {
      setState({ ok: false, text: err instanceof APIError ? err.message : "Save failed" });
    }
  }

  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0">
      {def.type === "boolean" ? (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={Boolean(draft)}
            onChange={(e) => {
              setDraft(e.target.checked);
              void save(e.target.checked);
            }}
          />
          <span>
            <span className={`font-semibold ${def.key === "autopilotStop" && draft ? "text-red-700" : "text-slate-800"}`}>{def.label}</span>
            {def.help ? <span className="block text-xs text-slate-500">{def.help}</span> : null}
          </span>
        </label>
      ) : (
        <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_auto]">
          <div>
            <label className={labelClass}>{def.label}</label>
            {def.type === "select" ? (
              <select value={String(draft)} onChange={(e) => setDraft(e.target.value)} className={inputClass}>
                {def.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={def.type === "date" ? "date" : def.type === "number" ? "number" : "text"}
                value={String(draft ?? "")}
                onChange={(e) => setDraft(def.type === "number" ? Number(e.target.value) : e.target.value)}
                className={inputClass}
              />
            )}
            {def.help ? <p className="mt-1 text-xs text-slate-400">{def.help}</p> : null}
          </div>
          <Button onClick={() => void save()} disabled={!dirty}>
            Save
          </Button>
        </div>
      )}
      {state ? <p className={`mt-1 text-xs ${state.ok ? "text-emerald-700" : "text-red-700"}`}>{state.text}</p> : null}
    </div>
  );
}

function MusicLibrary() {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    setFiles(await api.get<MediaFile[]>("/api/media/music").catch(() => []));
  }
  useEffect(() => {
    void load();
  }, []);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file || !name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/media/music?name=${encodeURIComponent(name.trim())}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg", Authorization: `Bearer ${localStorage.getItem("eki_automation_token") ?? ""}` },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? `Upload failed (${res.status})`);
      setMsg({ ok: true, text: "Uploaded" });
      setName("");
      if (input.current) input.current.value = "";
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this track?")) return;
    await api.delete(`/api/media/music/${id}`).catch(() => undefined);
    await load();
  }

  return (
    <Card>
      <p className="font-bold text-slate-900">Music library</p>
      <p className="mt-1 text-xs text-slate-500">Royalty-free tracks you own the rights to. Selected per video; mixed quietly under the voiceover. MP3/WAV/AAC/M4A, max 25 MB.</p>
      <form onSubmit={upload} className="mt-3 grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className={labelClass}>Track name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={120} />
        </div>
        <input ref={input} type="file" accept="audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a,.aac" className="text-sm" />
        <Button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </form>
      {msg ? <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p> : null}
      <ul className="mt-3 space-y-1 text-sm">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between">
            <span>
              {f.name} <span className="text-xs text-slate-400">· {formatBytes(f.sizeBytes)} · {timeAgo(f.createdAt)}</span>
            </span>
            <button onClick={() => void remove(f.id)} className="text-xs font-semibold text-red-600">
              Delete
            </button>
          </li>
        ))}
        {files.length === 0 ? <li className="text-xs text-slate-400">No tracks yet.</li> : null}
      </ul>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/auth/password", { currentPassword: current, newPassword: next });
      setMsg({ ok: true, text: "Password changed" });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ ok: false, text: err instanceof APIError ? err.message : "Failed" });
    }
  }
  return (
    <Card>
      <p className="font-bold text-slate-900">Admin password</p>
      <form onSubmit={submit} className="mt-3 grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className={labelClass}>Current password</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} autoComplete="current-password" />
        </div>
        <div>
          <label className={labelClass}>New password (min 12 characters)</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} minLength={12} autoComplete="new-password" />
        </div>
        <Button type="submit">Change</Button>
      </form>
      {msg ? <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p> : null}
    </Card>
  );
}

interface TeamMember {
  id: string;
  email: string;
  role: "OWNER" | "ADMIN" | "VIEWER";
  lastLoginAt: string | null;
}

function TeamCard() {
  const [users, setUsers] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TeamMember["role"]>("ADMIN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setUsers(await api.get<TeamMember[]>("/api/users"));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Could not load team");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/users", { email, password, role });
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Could not add user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="font-bold text-slate-900">Team access</p>
      <p className="mb-3 text-xs text-slate-500">Role is enforced server-side: a Viewer token is rejected on every write, not just hidden in the UI.</p>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <ul className="space-y-2 text-sm">
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
            <span>
              {u.email} <span className="text-xs text-slate-400">{u.lastLoginAt ? `· last login ${timeAgo(u.lastLoginAt)}` : "· never logged in"}</span>
            </span>
            <div className="flex items-center gap-2">
              <select
                className="rounded border border-slate-200 px-2 py-1 text-xs"
                value={u.role}
                onChange={async (e) => {
                  await api.put(`/api/users/${u.id}/role`, { role: e.target.value });
                  await load();
                }}
              >
                <option value="OWNER">Owner</option>
                <option value="ADMIN">Admin</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={async () => {
                  try {
                    await api.delete(`/api/users/${u.id}`);
                    await load();
                  } catch (err) {
                    setError(err instanceof APIError ? err.message : "Could not remove user");
                  }
                }}
              >
                remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <input className={`${inputClass} mt-0 w-48`} type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className={`${inputClass} mt-0 w-40`} type="password" placeholder="password (min 12 chars)" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <select className="mt-0 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as TeamMember["role"])}>
          <option value="ADMIN">Admin</option>
          <option value="VIEWER">Viewer</option>
          <option value="OWNER">Owner</option>
        </select>
        <Button type="submit" variant="secondary" disabled={busy}>
          Add team member
        </Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const [schema, setSchema] = useState<SettingDefinition[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await api.get<{ schema: SettingDefinition[]; values: Record<string, unknown> }>("/api/settings");
      setSchema(r.schema);
      setValues(r.values);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, SettingDefinition[]>();
    for (const s of schema) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m.entries()];
  }, [schema]);

  return (
    <ControlCenterLayout>
      <PageHeader title="Settings" subtitle="Business details, safety switches and defaults. Values marked for n8n are delivered to the automations automatically — no server access needed." />
      {values.autopilotStop === true ? (
        <div className="mb-4">
          <Notice tone="red">Emergency stop is ON: social autopilot generation and posting are halted.</Notice>
        </div>
      ) : null}
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <div className="space-y-6">
          {groups.map(([group, defs]) => (
            <Card key={group}>
              <p className="mb-2 font-bold text-slate-900">{group}</p>
              {defs.map((d) => (
                <SettingRow key={d.key} def={d} value={values[d.key]} onSaved={load} />
              ))}
            </Card>
          ))}
          <MusicLibrary />
          <TeamCard />
          <PasswordCard />
        </div>
      )}
    </ControlCenterLayout>
  );
}
