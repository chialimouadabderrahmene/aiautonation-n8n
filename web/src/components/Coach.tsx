"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHome } from "@/lib/home";

const KEY = "eki_coach_state";

function read(): "open" | "closed" | "gone" {
  try {
    const v = localStorage.getItem(KEY);
    return v === "open" || v === "gone" ? v : "closed";
  } catch {
    return "closed";
  }
}

/** The checklist that teaches the product. It ticks itself from what the team has really done. */
export default function Coach() {
  const { data } = useHome();
  const pathname = usePathname();
  const [state, setState] = useState<"open" | "closed" | "gone" | null>(null);

  useEffect(() => setState(read()), []);

  const update = (next: "open" | "closed" | "gone") => {
    setState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Private window: the coach just reappears next visit. */
    }
  };

  // These two screens have controls along the bottom edge that the pill would sit on.
  const crowded = pathname.startsWith("/review/") || pathname === "/people";
  if (!data || state === null || state === "gone" || (crowded && state === "closed")) return null;
  const done = data.guide.filter((g) => g.done).length;
  const total = data.guide.length;
  if (done === total) return null;
  const next = data.guide.find((g) => !g.done);

  if (state === "closed") {
    return (
      <button
        onClick={() => update("open")}
        className="fixed bottom-20 right-4 z-30 md:left-6 md:right-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-lift md:bottom-6"
      >
        <span className="rounded-full bg-plantain px-2 py-0.5 text-xs text-ink">{done}/{total}</span>
        <span className="sm:hidden">Learn</span>
        <span className="hidden sm:inline">Next: {next?.title}</span>
      </button>
    );
  }

  return (
    <aside className="rise fixed bottom-20 right-4 z-30 md:left-6 md:right-auto w-[calc(100vw-2rem)] max-w-xs rounded-3xl bg-ink p-5 text-paper shadow-lift md:bottom-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-bold">Learn Eki by doing it</p>
          <p className="text-xs text-paper/60">{done} of {total} done. Ticks itself as you go.</p>
        </div>
        <button onClick={() => update("closed")} aria-label="Minimise" className="rounded-full px-2 text-lg leading-none text-paper/60 hover:text-paper">–</button>
      </div>
      <ol className="mt-4 space-y-1">
        {data.guide.map((g, i) => {
          const isNext = g.id === next?.id;
          return (
            <li key={g.id}>
              <Link href={g.href} className={`flex items-start gap-3 rounded-xl px-2 py-1.5 ${isNext ? "bg-paper/10" : ""}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${g.done ? "bg-leaf text-white" : isNext ? "bg-palm text-white" : "bg-paper/15 text-paper/60"}`}>
                  {g.done ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${g.done ? "text-paper/50 line-through" : ""}`}>{g.title}</span>
                  {isNext ? <span className="block text-xs text-paper/70">{g.hint}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex items-center justify-between border-t border-paper/15 pt-3 text-xs">
        <Link href="/guide" className="font-semibold text-plantain">Watch the 60-second demo</Link>
        <button onClick={() => update("gone")} className="text-paper/50 hover:text-paper">Hide</button>
      </div>
    </aside>
  );
}
