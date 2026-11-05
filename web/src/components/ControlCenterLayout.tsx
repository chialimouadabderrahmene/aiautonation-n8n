"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { api, clearToken, hasToken } from "@/lib/api";
import { HomeProvider, useHome } from "@/lib/home";
import Coach from "./Coach";

const NAV = [
  { name: "Today", href: "/", icon: "M3 11l9-8 9 8M5 10v10h14V10" },
  { name: "Make", href: "/make", icon: "M12 5v14M5 12h14" },
  { name: "Review", href: "/review", icon: "M5 13l4 4L19 7" },
  { name: "People", href: "/people", icon: "M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4M12 12a3 3 0 100-6 3 3 0 000 6z" },
  { name: "Autopilot", href: "/autopilot", icon: "M13 3L4 14h7l-1 7 9-11h-7l1-7z" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, refresh } = useHome();
  const [email, setEmail] = useState("");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.get<{ email: string }>("/api/auth/me").then((m) => setEmail(m.email)).catch(() => undefined);
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => setMenu(false), [pathname]);

  const review = data?.counts.review ?? 0;

  async function resume() {
    await api.put("/api/settings/autopilotStop", { value: false });
    await refresh();
  }

  return (
    <div className="min-h-screen bg-paper pb-24 md:pb-10">
      {data?.stopped ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-berry px-4 py-2 text-sm font-semibold text-white">
          Everything is stopped. Nothing will be sent or posted.
          <button onClick={() => void resume()} className="rounded-full bg-white px-3 py-0.5 text-xs font-bold text-berry">Start again</button>
        </div>
      ) : null}
      {data?.practice ? (
        <div className="tape px-4 py-1.5 text-center text-xs font-bold text-ink sm:text-sm">
          PRACTICE MODE. <span className="hidden sm:inline">Nothing here is real, and nothing gets sent, posted or charged.</span><span className="sm:hidden">Nothing real gets sent.</span>{" "}
          <Link href="/setup" className="hidden underline underline-offset-2 sm:inline">Go live when you are ready</Link>
        </div>
      ) : null}

      <header className="sticky top-0 z-20 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="font-display text-3xl font-extrabold leading-none tracking-tight">
            eki<span className="text-palm">.</span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={`relative rounded-full px-4 py-2 text-[15px] font-semibold transition ${isActive(pathname, n.href) ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}
              >
                {n.name}
                {n.href === "/review" && review > 0 ? <span className="ml-1.5 rounded-full bg-palm px-1.5 py-0.5 text-[11px] font-bold text-white">{review}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            {data?.practice ? (
              <Link href="/setup" className="rounded-full border border-rule px-3 py-1.5 text-sm font-semibold text-ink-soft hover:border-ink hover:text-ink">
                Go live <span className="text-ink-faint">{data.setup.done}/{data.setup.total}</span>
              </Link>
            ) : data ? (
              <span className="flex items-center gap-1.5 rounded-full bg-leaf-wash px-3 py-1.5 text-sm font-semibold text-leaf-deep">
                <span className="pulse-dot h-2 w-2 rounded-full bg-leaf" /> Live
              </span>
            ) : null}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenu((v) => !v)} aria-label="Account menu" aria-expanded={menu}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink font-display text-sm font-bold uppercase text-paper"
              >
                {email ? email[0] : "e"}
              </button>
              {menu ? (
                <div className="absolute right-0 top-11 w-56 rounded-2xl border border-rule bg-card p-2 shadow-lift">
                  {email ? <p className="truncate px-3 py-1.5 text-xs text-ink-faint">{email}</p> : null}
                  {[["How Eki works", "/guide"], ["Connect accounts", "/setup"], ["Results", "/reports"], ["Back office", "/back-office"], ["Settings", "/settings"]].map(([label, href]) => (
                    <Link key={href} href={href!} className="block rounded-xl px-3 py-2 text-sm font-medium hover:bg-paper">{label}</Link>
                  ))}
                  <button onClick={() => { clearToken(); router.push("/login"); }} className="block w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-berry hover:bg-berry-wash">
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="weave" aria-hidden />
      </header>

      <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 sm:py-10">{children}</main>

      <nav className="fixed inset-x-3 bottom-3 z-20 flex justify-between rounded-full bg-ink px-2 py-1.5 shadow-lift md:hidden" aria-label="Main">
        {NAV.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link key={n.href} href={n.href} aria-label={n.name} aria-current={active ? "page" : undefined} className={`relative flex flex-1 flex-col items-center rounded-full py-1.5 text-[10px] font-semibold ${active ? "bg-paper text-ink" : "text-paper/70"}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={n.icon} /></svg>
              {n.name}
              {n.href === "/review" && review > 0 ? <span className="absolute right-2 top-0.5 h-2 w-2 rounded-full bg-palm" /> : null}
            </Link>
          );
        })}
      </nav>
      <Coach />
    </div>
  );
}

/** The app frame every signed-in screen sits in. */
export default function ControlCenterLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hasToken()) router.replace("/login");
    else setChecked(true);
  }, [router]);

  if (!checked) return null;
  return (
    <HomeProvider>
      <Frame>{children}</Frame>
    </HomeProvider>
  );
}
