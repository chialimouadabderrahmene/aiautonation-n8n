"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, hasToken } from "@/lib/api";

const GROUPS = [
  { label: "Command", items: [{ name: "Dashboard", href: "/dashboard", icon: "⌂" }, { name: "Approvals", href: "/approvals", icon: "✓" }] },
  { label: "Create", items: [{ name: "Content Studio", href: "/content-studio", icon: "✦" }, { name: "Video Generator", href: "/video", icon: "▶" }, { name: "Carousel Studio", href: "/carousels", icon: "▦" }] },
  { label: "Operate", items: [{ name: "Automations", href: "/automations", icon: "⚙" }, { name: "Integrations", href: "/integrations", icon: "◎" }, { name: "Executions", href: "/executions", icon: "≡" }, { name: "Reports", href: "/reports", icon: "↗" }] },
];

export default function ControlCenterLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { if (!hasToken()) router.replace("/login"); else setChecked(true); }, [router]);
  useEffect(() => setOpen(false), [pathname]);
  if (!checked) return null;

  const signOut = () => { clearToken(); router.push("/login"); };
  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="flex min-h-screen">
        {open ? <button aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" /> : null}
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col bg-[#0b1f1a] text-white shadow-2xl transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="border-b border-white/10 px-6 py-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-400 font-black text-[#0b1f1a]">E</div>
              <div><p className="font-black tracking-tight">EKI Control Center</p><p className="text-xs text-emerald-200/60">Acquisition operating system</p></div>
            </div>
          </div>
          <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-6">
            {GROUPS.map((group) => <div key={group.label}><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200/40">{group.label}</p><div className="space-y-1">{group.items.map((item) => { const active = pathname === item.href || pathname.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-emerald-400 text-[#0b1f1a] shadow-lg shadow-emerald-950/20" : "text-white/65 hover:bg-white/10 hover:text-white"}`}><span className="grid w-5 place-items-center text-sm">{item.icon}</span>{item.name}</Link>; })}</div></div>)}
          </nav>
          <div className="border-t border-white/10 p-4">
            <Link href="/settings" className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/65 hover:bg-white/10 hover:text-white"><span>⚙</span> Settings</Link>
            <button onClick={signOut} className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-white/45 hover:bg-white/10 hover:text-white">Sign out</button>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/85 px-5 backdrop-blur lg:px-9">
            <div className="flex items-center gap-3"><button aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-xl border border-slate-200 p-2 text-slate-600 lg:hidden">☰</button><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace</p><p className="font-bold text-slate-800">Eki / EHIMA GROUP LTD</p></div></div>
            <div className="flex items-center gap-3"><span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Native runtime online</span><Link href="/settings" className="grid h-9 w-9 place-items-center rounded-full bg-[#0b1f1a] text-sm font-black text-emerald-300">EH</Link></div>
          </header>
          <main className="mx-auto w-full max-w-[1480px] p-5 lg:p-9">{children}</main>
        </div>
      </div>
    </div>
  );
}
