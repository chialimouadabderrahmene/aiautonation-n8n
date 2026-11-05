"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { Banner, Btn, Phone } from "@/components/kit";
import { api, APIError } from "@/lib/api";
import { TARGET_LABEL, useHome } from "@/lib/home";

const IDEA = "Why buying egusi abroad is so hard";
const CUSTOMER_LINE = "Hello";

const CHAPTERS = [
  { title: "You type one idea", body: "That is the only thing Eki needs. One sentence, in your own words." },
  { title: "Eki makes it", body: "It writes the script, records the voice, films the scenes and edits them together. You can walk away." },
  { title: "You check it", body: "Nothing ever goes out without you. Approve it, change the words, or ask for a new version." },
  { title: "It goes out", body: "Eki posts it to your accounts, now or at the time you choose." },
  { title: "Customers get answered", body: "When someone messages, Eki replies in seconds, finds out if they buy or sell, and follows up." },
  { title: "You see it all in one place", body: "Today shows what is moving, what needs you, and how the week is going." },
];

interface Job { state: string; progress: number; error: string | null; caption: string | null; finalVideo?: { playUrl: string | null } | null; publications: { id: string; target: string; status: string }[] }
interface Talk { messageText: string; replySent: string | null }

const STAGE_WORD: Record<string, string> = {
  QUEUED: "Getting started", SCRIPT_GENERATING: "Writing the script", STORYBOARD_READY: "Planning the scenes", VOICE_GENERATING: "Recording the voice",
  VISUAL_GENERATING: "Filming the scenes", ASSEMBLING: "Editing it together", QUALITY_CHECK: "Checking quality", READY: "Ready",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Demo() {
  const { data, refresh } = useHome();
  const [chapter, setChapter] = useState(-1);
  const [typed, setTyped] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [talk, setTalk] = useState<Talk | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState("");
  const approveNow = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    setError("");
    setJob(null);
    setTalk(null);
    setTyped("");
    try {
      // 1. Idea
      setChapter(0);
      for (let i = 1; i <= IDEA.length && alive.current; i++) {
        setTyped(IDEA.slice(0, i));
        await sleep(32);
      }
      await sleep(700);

      // 2. Make, for real
      const { job: created } = await api.post<{ job: { id: string } }>("/api/video/projects", {
        name: IDEA, contentType: "Instagram Reel", topic: IDEA, prompt: IDEA, durationSec: 15, publishTargets: ["instagram", "facebook"],
      });
      setChapter(1);
      let current: Job;
      for (;;) {
        if (!alive.current) return;
        current = await api.get<Job>(`/api/video/jobs/${created.id}`);
        setJob(current);
        if (current.state === "FAILED") throw new Error(current.error ?? "The video stopped part way through.");
        if (current.state === "READY") break;
        await sleep(1200);
      }

      // 3. Approve: the viewer can press the button, or it carries on so the demo never stalls.
      setChapter(2);
      await new Promise<void>((resolve) => {
        approveNow.current = resolve;
        let left = 8;
        setCountdown(left);
        const t = setInterval(() => {
          left -= 1;
          setCountdown(left);
          if (left <= 0) {
            clearInterval(t);
            resolve();
          }
        }, 1000);
      });
      setCountdown(null);
      approveNow.current = null;
      await api.post(`/api/approvals/video/${created.id}/decision`, { decision: "APPROVED" });

      // 4. Post
      setChapter(3);
      for (let i = 0; i < 40 && alive.current; i++) {
        current = await api.get<Job>(`/api/video/jobs/${created.id}`);
        setJob(current);
        if (current.publications.length && current.publications.every((p) => p.status === "PUBLISHED")) break;
        await sleep(800);
      }
      await sleep(1800);

      // 5. A customer writes in, and the real engine answers.
      setChapter(4);
      await api.post("/api/autopilots/welcome-leads/on");
      const { phone } = await api.post<{ phone: string }>("/api/practice/message", { name: "Demo customer", text: CUSTOMER_LINE });
      setTalk({ messageText: CUSTOMER_LINE, replySent: null });
      for (let i = 0; i < 30 && alive.current; i++) {
        const [person] = await api.get<{ id: string }[]>(`/api/people?q=${phone}`);
        if (person) {
          const full = await api.get<{ conversation: Talk[] }>(`/api/people/${person.id}`);
          const answered = full.conversation.find((m) => m.replySent);
          if (answered) {
            setTalk(answered);
            break;
          }
        }
        await sleep(1000);
      }
      await sleep(3000);

      // 6. Done
      setChapter(5);
      await refresh();
    } catch (err) {
      setError(err instanceof APIError || err instanceof Error ? err.message : "The demo stopped.");
    }
  }, [refresh]);

  const notPractice = data && !data.practice;
  const offline = data && !data.system.ok;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <ol className="space-y-2">
          {CHAPTERS.map((c, i) => {
            const state = chapter > i ? "done" : chapter === i ? "now" : "later";
            return (
              <li key={c.title} className={`rounded-2xl p-4 transition ${state === "now" ? "bg-ink text-paper shadow-lift" : state === "done" ? "bg-leaf-wash" : "bg-slate-100"}`}>
                <div className="flex gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${state === "now" ? "bg-palm text-white" : state === "done" ? "bg-leaf text-white" : "bg-white text-ink-faint"}`}>
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold leading-tight">{c.title}</h2>
                    <p className={`mt-0.5 text-sm ${state === "now" ? "text-paper/80" : "text-ink-soft"}`}>{c.body}</p>

                    {state === "now" && i === 0 ? <p className="mt-3 rounded-xl bg-paper/10 px-3 py-2 font-mono text-sm">{typed}<span className="pulse-dot">|</span></p> : null}
                    {state === "now" && i === 1 && job ? (
                      <div className="mt-3">
                        <p className="text-sm font-semibold">{STAGE_WORD[job.state] ?? job.state}</p>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper/15"><div className="h-full rounded-full bg-plantain transition-all duration-700" style={{ width: `${Math.max(4, job.progress)}%` }} /></div>
                      </div>
                    ) : null}
                    {state === "now" && i === 2 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Btn tone="leaf" onClick={() => approveNow.current?.()}>Approve and post</Btn>
                        {countdown !== null ? <span className="text-xs text-paper/70">Carrying on by itself in {countdown}s</span> : null}
                      </div>
                    ) : null}
                    {state === "now" && i === 3 && job ? (
                      <ul className="mt-3 space-y-1 text-sm">
                        {job.publications.map((p) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <span className={p.status === "PUBLISHED" ? "text-plantain" : "pulse-dot text-paper/60"}>{p.status === "PUBLISHED" ? "✓" : "•"}</span>
                            {TARGET_LABEL[p.target] ?? p.target}{p.status === "PUBLISHED" ? ": would have posted (practice)" : ": posting"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {state === "now" && i === 4 && talk ? (
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-paper px-3 py-2 text-ink">{talk.messageText}</p>
                        {talk.replySent
                          ? <p className="rise ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-leaf px-3 py-2">{talk.replySent.replace(/\*/g, "")}</p>
                          : <p className="pulse-dot ml-auto w-fit rounded-2xl bg-leaf/60 px-3 py-2 text-xs">Eki is replying...</p>}
                      </div>
                    ) : null}
                    {state === "now" && i === 5 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Btn href="/" tone="palm">See it on Today</Btn>
                        <Btn href="/make" tone="ghost" className="border-paper/30 text-paper hover:border-paper">Try it yourself</Btn>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        {error ? <div className="mt-4"><Banner tone="berry">{error}</Banner></div> : null}
      </div>

      <aside className="order-first lg:order-last lg:sticky lg:top-28 lg:self-start">
        <Phone>
          {job?.finalVideo?.playUrl ? (
            <video key={job.finalVideo.playUrl} src={job.finalVideo.playUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-palm via-plantain to-ink p-6 text-center">
              <p className="font-display text-6xl font-extrabold text-white">eki<span className="text-ink">.</span></p>
              {chapter === -1 ? (
                <Btn tone="ink" big disabled={Boolean(notPractice || offline)} onClick={() => void start()}>Start the demo</Btn>
              ) : (
                <p className="text-sm font-semibold text-white">{job ? `${job.progress}%` : "Starting..."}</p>
              )}
            </div>
          )}
        </Phone>
        {chapter === 5 ? <div className="mt-3 text-center"><Btn tone="ghost" onClick={() => void start()}>Watch it again</Btn></div> : null}
        {notPractice ? <p className="mt-3 text-center text-sm text-ink-faint">The demo runs in Practice mode only, so nothing real is ever sent. <Link href="/setup" className="underline">Switch back</Link></p> : null}
        {offline ? <p className="mt-3 text-center text-sm text-berry">The studio is offline, so the demo cannot run. Send this to your developer.</p> : null}
        {!notPractice && !offline ? <p className="mt-3 text-center text-xs text-ink-faint">This really runs, using sample data. Nothing leaves Eki.</p> : null}
      </aside>
    </div>
  );
}

const QUESTIONS = [
  ["Will it post anything without asking me?", "No. Content always waits in Review. The only things that go out by themselves are WhatsApp replies and follow-ups, and only if you switch that autopilot on."],
  ["What do I need to start?", "Nothing. Practice mode needs no accounts and costs nothing. Connect your accounts one at a time when you are ready to go live."],
  ["What if something goes wrong?", "Eki retries by itself. If it still cannot finish, it stops, tells you why in plain words and gives you a Try again button. Nothing half-finished is ever posted."],
  ["Can I stop everything at once?", "Yes. Autopilot has a Stop everything button. It works straight away, even for work already scheduled."],
  ["Can the whole team use it?", "Yes. Add people in Settings and choose what each person is allowed to do."],
];

export default function GuidePage() {
  return (
    <ControlCenterLayout>
      <div className="mb-8">
        <h1 className="text-5xl font-extrabold sm:text-6xl">How Eki works</h1>
        <p className="mt-2 max-w-2xl text-lg text-ink-soft">Press start and watch one idea become a posted reel, then watch a customer get answered. About a minute.</p>
      </div>
      <Demo />
      <section className="mt-14">
        <h2 className="mb-4 text-3xl font-bold">Questions people ask</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {QUESTIONS.map(([q, a]) => (
            <div key={q} className="rounded-2xl bg-card p-5 shadow-ticket">
              <h3 className="font-sans text-base font-bold tracking-normal">{q}</h3>
              <p className="mt-1 text-sm text-ink-soft">{a}</p>
            </div>
          ))}
        </div>
      </section>
    </ControlCenterLayout>
  );
}
