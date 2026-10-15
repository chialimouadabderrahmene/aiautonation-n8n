"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, clearToken, hasToken } from "@/lib/api";
import {
  BellIcon,
  BoltIcon,
  BookIcon,
  CarouselIcon,
  ChartIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  DashboardIcon,
  DocIcon,
  GearIcon,
  LayersIcon,
  PuzzleIcon,
  SearchIcon,
  SignOutIcon,
  SparkleIcon,
  UsersIcon,
  VideoIcon,
  WhatsAppIcon,
} from "@/components/icons";

type NavItem = { name: string; href: string; icon: (p: { size?: number; className?: string }) => JSX.Element };
type NavGroup = { label: string; items: NavItem[] };

const NAV: NavGroup[] = [
  { label: "Overview", items: [{ name: "Dashboard", href: "/dashboard", icon: DashboardIcon }] },
  {
    label: "Automate",
    items: [
      { name: "Automations", href: "/automations", icon: BoltIcon },
      { name: "Workflow Engine", href: "/workflow-engine", icon: LayersIcon },
      { name: "Approvals", href: "/approvals", icon: CheckSquareIcon },
    ],
  },
  {
    label: "Create",
    items: [
      { name: "Brand Brain", href: "/brand-brain", icon: SparkleIcon },
      { name: "Content Studio", href: "/content-studio", icon: DocIcon },
      { name: "Content Drafts", href: "/workflow-engine/content-drafts", icon: DocIcon },
      { name: "Video Generator", href: "/video", icon: VideoIcon },
      { name: "Carousels", href: "/carousels", icon: CarouselIcon },
    ],
  },
  {
    label: "Engage",
    items: [
      { name: "WhatsApp", href: "/whatsapp", icon: WhatsAppIcon },
      { name: "Connected Apps", href: "/connected-apps", icon: PuzzleIcon },
      { name: "Connected Accounts", href: "/connected-accounts", icon: UsersIcon },
      { name: "Integrations", href: "/integrations", icon: PuzzleIcon },
    ],
  },
  {
    label: "Monitor",
    items: [
      { name: "Executions", href: "/executions", icon: ChartIcon },
      { name: "Reports", href: "/reports", icon: ChartIcon },
    ],
  },
  {
    label: "",
    items: [
      { name: "Documentation", href: "/docs", icon: BookIcon },
      { name: "Settings", href: "/settings", icon: GearIcon },
    ],
  },
];

const FLAT_NAV = NAV.flatMap((g) => g.items);

export default function ControlCenterLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  // Below md (768px) the sidebar is off-canvas by default — confirmed by
  // actually rendering this at 375px width: a permanently-visible w-64
  // sidebar left ~50% of a phone viewport unusable and clipped every page's
  // content (dashboard stat cards, headings, etc. all cut off mid-word).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);
  const [alerts, setAlerts] = useState(0);
  const [stop, setStop] = useState<{ active: boolean; changedAt: string | null; changedBy: string | null } | null>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasToken()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  useEffect(() => {
    if (!checked) return;
    void api.get<{ email: string; role: string }>("/api/auth/me").then(setMe).catch(() => undefined);
    const poll = () =>
      void api
        .get<{ actionRequired: unknown[]; emergencyStop: { active: boolean; changedAt: string | null; changedBy: string | null } }>("/api/dashboard")
        .then((d) => {
          setAlerts(d.actionRequired?.length ?? 0);
          setStop(d.emergencyStop ?? null);
        })
        .catch(() => undefined);
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [checked]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return FLAT_NAV.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query]);

  if (!checked) return null;

  const signOut = () => {
    clearToken();
    router.push("/login");
  };

  const goToFirstMatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (matches[0]) {
      router.push(matches[0].href);
      setQuery("");
    }
  };

  return (
    <div className="flex min-h-screen bg-[#f6f7f9]">
      {/* Mobile top bar: hamburger + brand, visible only below md. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-brand-700 px-4 py-3 text-white md:hidden">
        <div className="flex items-center gap-2">
          <BoltIcon size={20} className="text-brand-50" />
          <div>
            <p className="text-base font-black leading-tight">Eki AI Automation</p>
          </div>
        </div>
        <button
          type="button"
          aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((v) => !v)}
          className="rounded-lg p-2 hover:bg-white/10"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {mobileNavOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {/* Backdrop, mobile only, closes the drawer on tap outside it. */}
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 overflow-y-auto bg-brand-700 text-white transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
            <BoltIcon size={18} />
          </span>
          <div>
            <p className="text-base font-black leading-tight">Eki</p>
            <p className="text-[11px] font-medium leading-tight text-white/60">AI Automation</p>
          </div>
        </div>
        <nav className="mt-2 space-y-5 px-3 pb-6">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.label ? <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-white/35">{group.label}</p> : null}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                        active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon size={17} className={active ? "text-brand-50" : "text-white/50"} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* pt-16 on mobile clears the fixed top bar; md: removes it since the
          sidebar goes back to being a normal static flex sibling there. */}
      <div className="flex w-full flex-1 flex-col pt-14 md:pt-0">
        {/* Desktop top bar: search, alerts, account menu. */}
        <header className="hidden items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3 md:flex">
          <form onSubmit={goToFirstMatch} className="relative w-80">
            <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search automations, content, integrations..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-14 text-sm outline-none focus:border-brand-500 focus:bg-white"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              Ctrl K
            </kbd>
            {matches.length > 0 ? (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                {matches.map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    onClick={() => setQuery("")}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <m.icon size={15} className="text-slate-400" />
                    {m.name}
                  </Link>
                ))}
              </div>
            ) : null}
          </form>

          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Alerts">
              <BellIcon size={18} />
              {alerts > 0 ? (
                <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {alerts > 9 ? "9+" : alerts}
                </span>
              ) : null}
            </Link>
            <div className="relative" ref={menuRef}>
              <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
                  {(me?.email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="text-left">
                  <span className="block text-sm font-semibold leading-tight text-slate-900">{me?.email?.split("@")[0] ?? "..."}</span>
                  <span className="block text-[11px] leading-tight text-slate-400">{me?.role ?? ""}</span>
                </span>
                <ChevronDownIcon size={14} className="text-slate-400" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <Link href="/settings" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Settings
                  </Link>
                  <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    <SignOutIcon size={14} />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {stop?.active ? (
          <div role="alert" className="border-b border-red-300 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white md:px-8">
            Emergency stop is ON since {stop.changedAt ? new Date(stop.changedAt).toLocaleString() : "an unknown time"}
            {stop.changedBy ? ` by ${stop.changedBy}` : ""}. Customer-facing publishing, WhatsApp and email are refused and queued sends are cancelled.
            Internal team alerts still work. Only an Owner can resume, in Settings → Automation safety.
          </div>
        ) : null}
        <main className="w-full flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
