"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, Chip, PageTitle } from "@/components/kit";
import { api, APIError } from "@/lib/api";
import { useHome } from "@/lib/home";

interface Person {
  id: string; name: string | null; phone: string; market: string | null; source: string | null; type: "UNKNOWN" | "VENDOR" | "BUYER"; status: string; hot: boolean; optIn: boolean; lastMessage: string | null; lastAt: string;
}
interface Conversation {
  id: string; name: string | null; phone: string; market: string | null; source: string | null; leadType: string; status: string; highIntent: boolean;
  conversation: { id: string; messageText: string; replySent: string | null; createdAt: string }[];
}

const FILTERS = [["all", "Everyone"], ["VENDOR", "Vendors"], ["BUYER", "Buyers"], ["hot", "Hot"]] as const;
const TYPE_WORD: Record<string, string> = { VENDOR: "Vendor", BUYER: "Buyer", UNKNOWN: "Not sure yet" };

const clean = (name: string | null, phone: string) => (name ?? `+${phone}`).replace(/^Sample: /, "");

/** WhatsApp marks bold as *word*; show it the way the customer sees it. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return <>{parts.map((part, i) => (part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <strong key={i}>{part.slice(1, -1)}</strong> : part))}</>;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function Chat({ id, practice, onSent }: { id: string; practice: boolean; onSent: () => void }) {
  const [person, setPerson] = useState<Conversation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => setPerson(await api.get<Conversation>(`/api/people/${id}`)), [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);

  const count = person?.conversation.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [count]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!person || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/api/practice/message", { phone: person.phone, name: clean(person.name, person.phone), text: text.trim() });
      setText("");
      onSent();
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  if (!person) return <div className="h-96 animate-pulse rounded-3xl bg-slate-100" />;
  return (
    <div className="flex h-[70vh] min-h-[440px] flex-col overflow-hidden rounded-3xl bg-card shadow-ticket">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3">
        <div>
          <p className="font-display text-xl font-bold">{clean(person.name, person.phone)}</p>
          <p className="text-xs text-ink-faint">{[TYPE_WORD[person.leadType], person.market, person.source].filter(Boolean).join(" · ")}</p>
        </div>
        {person.highIntent ? <span className="rounded-full bg-palm px-3 py-1 text-xs font-bold text-white">Hot lead</span> : null}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-5">
        {person.conversation.length === 0 ? <p className="py-10 text-center text-sm text-ink-faint">No messages yet.</p> : null}
        {person.conversation.map((m) => (
          <div key={m.id} className="space-y-3">
            <div className="flex">
              <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-4 py-2 text-sm shadow-sm">{m.messageText}<span className="mt-0.5 block text-[10px] text-ink-faint">{when(m.createdAt)}</span></p>
            </div>
            {m.replySent ? (
              <div className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-leaf px-4 py-2 text-sm text-white"><WhatsAppText text={m.replySent} /><span className="mt-0.5 block text-[10px] text-white/70">Eki replied automatically</span></p>
              </div>
            ) : null}
          </div>
        ))}
        <div ref={end} />
      </div>
      {practice ? (
        <form onSubmit={send} className="border-t border-rule bg-plantain-wash p-3">
          <label htmlFor="pretend" className="mb-1.5 block px-1 text-xs font-semibold">Pretend to be this person. Say hello, or try STOP.</label>
          <div className="flex gap-2">
            <input id="pretend" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoComplete="off" placeholder="Type what they would say" className="min-w-0 flex-1 rounded-full border border-rule bg-card px-4 py-2 outline-none focus:border-ink" />
            <Btn type="submit" tone="ink" disabled={busy || !text.trim()}>Send</Btn>
          </div>
          {error ? <p className="mt-2 px-1 text-sm text-berry">{error} <Link href="/autopilot" className="underline">Open Autopilot</Link></p> : null}
        </form>
      ) : (
        <p className="border-t border-rule px-5 py-3 text-xs text-ink-faint">Eki answers on WhatsApp automatically. Hot leads also alert your team.</p>
      )}
    </div>
  );
}

function People() {
  const { data } = useHome();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [newBusy, setNewBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const list = await api.get<Person[]>(`/api/people${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    setPeople(list);
    setSelected((cur) => cur ?? list[0]?.id ?? null);
  }, [q]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  async function newLead() {
    setNewBusy(true);
    setNotice("");
    try {
      const names = ["Bisi", "Emeka", "Ngozi", "Femi", "Amara"];
      const { phone } = await api.post<{ phone: string }>("/api/practice/message", { name: names[Math.floor(Math.random() * names.length)], text: "Hello" });
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const found = await api.get<Person[]>(`/api/people?q=${phone}`);
        if (found[0]) {
          setSelected(found[0].id);
          break;
        }
      }
      await load();
    } catch (err) {
      setNotice(err instanceof APIError ? err.message : "That did not send.");
    } finally {
      setNewBusy(false);
    }
  }

  const shown = (people ?? []).filter((p) => (filter === "all" ? true : filter === "hot" ? p.hot : p.type === filter));
  const practice = data?.practice ?? false;

  return (
    <>
      <PageTitle
        title="People"
        sub="Everyone who has reached out, and what Eki said back."
        action={practice ? <Btn tone="ink" disabled={newBusy} onClick={() => void newLead()}>{newBusy ? "Waiting for the reply..." : "Send a pretend lead"}</Btn> : undefined}
      />
      {notice ? <div className="mb-4"><Banner>{notice} <Link href="/autopilot" className="font-semibold underline">Open Autopilot</Link></Banner></div> : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or country" aria-label="Search people" className="mb-3 w-full rounded-full border border-rule bg-card px-4 py-2.5 outline-none focus:border-ink" />
          <div className="mb-3 flex flex-wrap gap-1.5">{FILTERS.map(([k, label]) => <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{label}</Chip>)}</div>
          <ul className="space-y-1.5">
            {people === null ? <li className="h-40 animate-pulse rounded-2xl bg-slate-100" /> : null}
            {people !== null && shown.length === 0 ? <li className="rounded-2xl bg-slate-100 p-6 text-center text-sm text-ink-faint">Nobody here yet.</li> : null}
            {shown.map((p) => (
              <li key={p.id}>
                <button onClick={() => setSelected(p.id)} aria-current={selected === p.id} className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left transition ${selected === p.id ? "bg-ink text-paper" : "bg-card hover:bg-white"}`}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display font-bold ${p.type === "VENDOR" ? "bg-plantain text-ink" : p.type === "BUYER" ? "bg-leaf text-white" : "bg-slate-200 text-ink"}`}>
                    {clean(p.name, p.phone)[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{clean(p.name, p.phone)}{p.hot ? <span className="ml-1.5 text-palm" title="Hot lead">●</span> : null}</span>
                      <span className={`shrink-0 text-[11px] ${selected === p.id ? "text-paper/60" : "text-ink-faint"}`}>{when(p.lastAt)}</span>
                    </span>
                    <span className={`block truncate text-sm ${selected === p.id ? "text-paper/70" : "text-ink-faint"}`}>{p.lastMessage ?? `${TYPE_WORD[p.type]}, from ${p.source ?? "unknown"}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selected ? <Chat key={selected} id={selected} practice={practice} onSent={() => void load()} /> : <div className="rounded-3xl bg-slate-100 p-16 text-center text-ink-faint">Pick someone to see the conversation.</div>}
      </div>
    </>
  );
}

export default function PeoplePage() {
  return (
    <ControlCenterLayout>
      <People />
    </ControlCenterLayout>
  );
}
