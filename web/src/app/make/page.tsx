"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, Chip, PageTitle } from "@/components/kit";
import { APIError } from "@/lib/api";
import { availableTargets, makePiece, TARGET_LABEL, useHome } from "@/lib/home";

const FOR = ["Buyers", "Vendors", "Both"];
const TONES = ["Warm", "Funny", "Straight talking", "Story"];
const LENGTHS = [15, 30, 60];
const WHAT_HAPPENS: Record<"video" | "carousel", string[]> = {
  video: ["Eki writes the script in your brand voice", "It records the voice and films each scene", "It edits it all together with captions", "You get it in Review. Nothing posts until you approve."],
  carousel: ["Eki writes each slide in your brand voice", "It designs the slides in your colours", "You get it in Review. Nothing posts until you approve."],
};

function Maker() {
  const router = useRouter();
  const { data } = useHome();
  const [format, setFormat] = useState<"video" | "carousel">("video");
  const [idea, setIdea] = useState("");
  const [forWho, setForWho] = useState("Both");
  const [tone, setTone] = useState("Warm");
  const [length, setLength] = useState(30);
  const [slides, setSlides] = useState(6);
  const [targets, setTargets] = useState<string[] | null>(null);
  const [more, setMore] = useState(false);
  const [language, setLanguage] = useState("en");
  const [cta, setCta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const available = availableTargets(data);
  useEffect(() => {
    if (data && targets === null) setTargets(available.slice(0, 2));
    // Pick a default once, then the choice is the team's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const blocked = data && !data.formats[format].ready ? data.formats[format].missing : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const audience = forWho === "Both" ? "African foodstuff buyers and vendors" : forWho === "Buyers" ? "People buying African foodstuff abroad" : "African foodstuff vendors";
      router.push(await makePiece({ format, idea: idea.trim(), targets: targets ?? [], audience, tone, durationSec: length, slideCount: slides, language, cta: cta.trim() || undefined }));
    } catch (err) {
      setError(err instanceof APIError ? err.message : "That did not start. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-7">
        <div className="grid grid-cols-2 gap-3">
          {(["video", "carousel"] as const).map((f) => (
            <button
              key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)}
              className={`rounded-3xl border-2 p-5 text-left transition ${format === f ? "border-ink bg-ink text-paper" : "border-rule bg-card hover:border-ink"}`}
            >
              <p className="font-display text-2xl font-bold">{f === "video" ? "Reel" : "Carousel"}</p>
              <p className={`mt-1 text-sm ${format === f ? "text-paper/70" : "text-ink-faint"}`}>{f === "video" ? "Short video with voice and captions" : "Swipeable slides people save and share"}</p>
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="idea" className="font-display text-xl font-bold">What is it about?</label>
          <textarea
            id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} rows={4} maxLength={2000} required
            placeholder="Say it the way you would tell a friend. For example: a vendor in Peckham who started selling palm oil from her kitchen."
            className="mt-2 w-full rounded-2xl border border-rule bg-card px-4 py-3 text-lg outline-none focus:border-ink"
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-2 font-semibold">Who is it for?</legend>
            <div className="flex flex-wrap gap-2">{FOR.map((v) => <Chip key={v} active={forWho === v} onClick={() => setForWho(v)}>{v}</Chip>)}</div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-semibold">How should it feel?</legend>
            <div className="flex flex-wrap gap-2">{TONES.map((v) => <Chip key={v} active={tone === v} onClick={() => setTone(v)}>{v}</Chip>)}</div>
          </fieldset>
          {format === "video" ? (
            <fieldset>
              <legend className="mb-2 font-semibold">How long?</legend>
              <div className="flex gap-2">{LENGTHS.map((v) => <Chip key={v} active={length === v} onClick={() => setLength(v)}>{v} seconds</Chip>)}</div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className="mb-2 font-semibold">How many slides?</legend>
              <div className="flex gap-2">{[4, 6, 8].map((v) => <Chip key={v} active={slides === v} onClick={() => setSlides(v)}>{v}</Chip>)}</div>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-2 font-semibold">Post it to</legend>
            {available.length ? (
              <div className="flex flex-wrap gap-2">
                {available.map((t) => (
                  <Chip key={t} active={targets?.includes(t)} onClick={() => setTargets((cur) => (cur?.includes(t) ? cur.filter((x) => x !== t) : [...(cur ?? []), t]))}>{TARGET_LABEL[t]}</Chip>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No accounts connected yet. You can still download it. <Link href="/setup" className="underline">Connect accounts</Link></p>
            )}
          </fieldset>
        </div>

        <div>
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="text-sm font-semibold text-ink-soft underline underline-offset-2">
            {more ? "Fewer options" : "More options"}
          </button>
          {more ? (
            <div className="rise mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="lang" className="mb-1 block text-sm font-semibold">Language</label>
                <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full rounded-xl border border-rule bg-card px-3 py-2.5 outline-none focus:border-ink">
                  <option value="en">English</option>
                  <option value="Nigerian Pidgin">Nigerian Pidgin</option>
                  <option value="fr">French</option>
                  <option value="it">Italian</option>
                </select>
              </div>
              <div>
                <label htmlFor="cta" className="mb-1 block text-sm font-semibold">What should people do next?</label>
                <input id="cta" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={200} placeholder="Download Eki today" className="w-full rounded-xl border border-rule bg-card px-3 py-2.5 outline-none focus:border-ink" />
              </div>
            </div>
          ) : null}
        </div>

        {blocked ? <Banner>This format needs {blocked.join(" and ")} first. <Link href="/setup" className="font-semibold underline">Connect it</Link></Banner> : null}
        {error ? <Banner tone="berry">{error}</Banner> : null}
        <Btn type="submit" big disabled={busy || !idea.trim() || Boolean(blocked)}>{busy ? "Starting..." : `Make this ${format === "video" ? "reel" : "carousel"}`}</Btn>
      </div>

      <aside className="h-fit rounded-3xl bg-slate-100 p-6 lg:sticky lg:top-28">
        <h2 className="text-lg font-bold">What happens next</h2>
        <ol className="mt-4 space-y-3">
          {WHAT_HAPPENS[format].map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-ink-soft">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink font-display text-xs font-bold text-paper">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-dashed border-slate-300 pt-4 text-sm text-ink-faint">You can close the page while it works. Eki keeps going and it will be waiting in Review.</p>
      </aside>
    </form>
  );
}

export default function MakePage() {
  return (
    <ControlCenterLayout>
      <PageTitle title="Make something" sub="One idea is enough. Eki handles the rest and asks you before anything goes out." />
      <Maker />
    </ControlCenterLayout>
  );
}
