"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, money, Ticket } from "@/components/kit";
import { APIError } from "@/lib/api";
import { availableTargets, HomeData, makePiece, Station, useHome } from "@/lib/home";

const STARTERS = [
  "Why buying egusi abroad is so hard",
  "What to cook when you miss home",
  "Vendors: stop taking orders in your DMs",
  "A day in the life of a foodstuff vendor",
];

const STATIONS: { key: Station; number: string; title: string; empty: string }[] = [
  { key: "making", number: "1", title: "Being made", empty: "Type an idea above and it starts here." },
  { key: "review", number: "2", title: "Waiting for you", empty: "Nothing to check." },
  { key: "scheduled", number: "3", title: "Going out", empty: "Nothing scheduled." },
  { key: "posted", number: "4", title: "Posted", empty: "Nothing posted yet." },
];

function headline(d: HomeData): { big: string; small: string; cta?: { label: string; href: string } } {
  const n = d.counts.review;
  if (n > 0) return { big: `${n} ${n === 1 ? "thing needs" : "things need"} you.`, small: "Everything else is moving on its own.", cta: { label: "Start reviewing", href: "/review" } };
  if (d.counts.making > 0) return { big: "Eki is on it.", small: `${d.counts.making} ${d.counts.making === 1 ? "piece" : "pieces"} being made. You can close this page.` };
  return { big: "All clear.", small: "What should Eki talk about next?" };
}

function Composer({ data }: { data: HomeData }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [format, setFormat] = useState<"video" | "carousel">("video");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = data.formats[format].ready ? null : data.formats[format].missing;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!idea.trim() || blocked) return;
    setBusy(true);
    setError("");
    try {
      router.push(await makePiece({ format, idea: idea.trim(), targets: availableTargets(data), durationSec: data.practice ? 15 : 30 }));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not start. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-3xl bg-ink p-4 text-paper shadow-lift sm:p-5">
      <label htmlFor="idea" className="mb-2 block px-2 text-sm font-semibold text-paper/70">What should Eki talk about?</label>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={300} autoComplete="off"
          placeholder="Type one idea, in your own words"
          className="min-w-0 flex-1 rounded-2xl bg-paper/10 px-4 py-4 text-lg text-paper outline-none placeholder:text-paper/40 focus:bg-paper/15"
        />
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-paper/10 p-1" role="group" aria-label="Format">
            {(["video", "carousel"] as const).map((f) => (
              <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${format === f ? "bg-paper text-ink" : "text-paper/70"}`}>
                {f === "video" ? "Reel" : "Carousel"}
              </button>
            ))}
          </div>
          <Btn type="submit" big disabled={busy || !idea.trim() || Boolean(blocked)}>{busy ? "Starting..." : "Make it"}</Btn>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
        {STARTERS.map((s) => (
          <button key={s} type="button" onClick={() => setIdea(s)} className="rounded-full border border-paper/20 px-3 py-1 text-xs text-paper/70 hover:border-paper hover:text-paper">{s}</button>
        ))}
        <Link href="/make" className="ml-auto text-xs font-semibold text-plantain">More options</Link>
      </div>
      {blocked ? <p className="mt-3 px-2 text-sm text-plantain">This format needs {blocked.join(" and ")}. <Link href="/setup" className="underline">Connect it</Link></p> : null}
      {error ? <p className="mt-3 px-2 text-sm text-plantain">{error}</p> : null}
    </form>
  );
}

function Line({ data }: { data: HomeData }) {
  const moving = data.counts.making > 0;
  return (
    <section aria-label="The line" className="mt-10">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-2xl font-bold">The line</h2>
        <p className="text-sm text-ink-faint">Every piece of content moves left to right.</p>
      </div>
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
        {STATIONS.map((s, i) => {
          const items = data.line[s.key];
          const attention = s.key === "review" && items.length > 0;
          return (
            <div key={s.key} className="w-[78vw] max-w-[320px] shrink-0 snap-start lg:w-auto lg:max-w-none">
              <div className="mb-3 flex items-center gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${attention ? "bg-palm text-white" : "bg-ink text-paper"}`}>{s.number}</span>
                <h3 className="whitespace-nowrap text-sm font-bold">{s.title}</h3>
                <span className="text-sm text-ink-faint">{items.length || ""}</span>
                {i < STATIONS.length - 1 ? <div className={`belt min-w-4 flex-1 ${moving && i === 0 ? "belt-live" : ""}`} aria-hidden /> : null}
              </div>
              <div className={`min-h-[132px] space-y-2.5 rounded-2xl p-2 ${attention ? "bg-palm-wash" : "bg-slate-100/70"}`}>
                {items.slice(0, 6).map((p) => <Ticket key={`${p.kind}-${p.id}`} piece={p} />)}
                {items.length > 6 ? <p className="px-2 pb-1 text-xs text-ink-faint">and {items.length - 6} more</p> : null}
                {items.length === 0 ? <p className="px-3 py-8 text-center text-xs text-ink-faint">{s.empty}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      {data.line.stopped.length ? (
        <p className="mt-3 text-sm text-ink-faint">
          {data.line.stopped.length} stopped or sent back:{" "}
          {data.line.stopped.slice(0, 3).map((p, i) => (
            <span key={p.id}>{i > 0 ? ", " : ""}<Link href={`/review/${p.kind}/${p.id}`} className="underline">{p.title.slice(0, 40)}</Link></span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

function Week({ data }: { data: HomeData }) {
  const cells = [
    { label: "Posted", value: data.week.posted, href: "/reports" },
    { label: "New people", value: data.week.leads, href: "/people" },
    { label: "Replies sent", value: data.week.replies, href: "/people" },
    { label: "Spent", value: money(data.week.costUsd), href: "/reports" },
  ];
  return (
    <section aria-label="This week" className="mt-10 grid gap-4 md:grid-cols-[1fr_320px]">
      <div className="rounded-3xl bg-card p-6 shadow-ticket">
        <h2 className="text-lg font-bold">This week{data.practice ? ", in practice" : ""}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {cells.map((c) => (
            <Link key={c.label} href={c.href} className="group">
              <dd className="font-display text-4xl font-bold group-hover:text-palm">{c.value}</dd>
              <dt className="mt-0.5 text-sm text-ink-faint">{c.label}</dt>
            </Link>
          ))}
        </dl>
        {data.week.newAccounts || data.week.newStores ? (
          <p className="mt-4 border-t border-dashed border-rule pt-3 text-sm text-ink-soft">
            On the Eki marketplace: <strong>{data.week.newAccounts}</strong> new {data.week.newAccounts === 1 ? "account" : "accounts"} and <strong>{data.week.newStores}</strong> new vendor {data.week.newStores === 1 ? "store" : "stores"}.
          </p>
        ) : null}
      </div>
      <Link href="/autopilot" className="flex flex-col justify-between rounded-3xl bg-leaf p-6 text-paper shadow-ticket transition hover:bg-leaf-deep">
        <h2 className="text-lg font-bold">Autopilot</h2>
        <p className="mt-4 font-display text-4xl font-bold">{data.autopilotsOn} of 6 on</p>
        <p className="mt-1 text-sm text-paper/80">{data.autopilotsOn ? "Working while you sleep." : "Switch one on to save hours."}</p>
      </Link>
    </section>
  );
}

function Today() {
  const { data, error } = useHome();
  if (!data) {
    return error ? <Banner tone="berry">{error}</Banner> : <div className="h-64 animate-pulse rounded-3xl bg-slate-100" />;
  }
  const h = headline(data);
  const firstVisit = data.practice && !data.guide[0]?.done;
  const hero = firstVisit
    ? { big: "Welcome to Eki.", small: "A safe place to learn. Everything really runs, on sample data, and nothing leaves this app.", cta: { label: "Watch it work (1 minute)", href: "/guide" } }
    : h;
  return (
    <>
      {data.problems.length ? (
        <div className="mb-6 space-y-2">
          {data.problems.map((p) => (
            <Banner key={p.title} tone="berry"><Link href={p.href}><strong>{p.title}.</strong> {p.detail}</Link></Banner>
          ))}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl font-extrabold leading-[1.02] sm:text-7xl">{hero.big}</h1>
          <p className="mt-3 text-lg text-ink-soft">{hero.small}</p>
        </div>
        {hero.cta ? <Btn href={hero.cta.href} big>{hero.cta.label} →</Btn> : null}
      </div>

      <Composer data={data} />
      <Line data={data} />
      <Week data={data} />
    </>
  );
}

export default function TodayPage() {
  return (
    <ControlCenterLayout>
      <Today />
    </ControlCenterLayout>
  );
}
