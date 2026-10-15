"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, hasToken } from "@/lib/api";

const NAV = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Integrations", href: "/integrations" },
  { name: "AI Content Studio", href: "/content-studio" },
  { name: "Video Generator", href: "/video" },
  { name: "Automations", href: "/automations" },
  { name: "Approvals", href: "/approvals" },
  { name: "Executions", href: "/executions" },
  { name: "Reports", href: "/reports" },
  { name: "Settings", href: "/settings" },
];

export default function ControlCenterLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  // Below md (768px) the sidebar is off-canvas by default — confirmed by
  // actually rendering this at 375px width: a permanently-visible w-64
  // sidebar left ~50% of a phone viewport unusable and clipped every page's
  // content (dashboard stat cards, headings, etc. all cut off mid-word).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!hasToken()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  // Close the mobile drawer on every navigation, so tapping a link doesn't
  // leave it open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (!checked) return null;

  const signOut = () => {
    clearToken();
    router.push("/login");
  };

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar: hamburger + brand, visible only below md. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-brand-700 px-4 py-3 text-white md:hidden">
        <div>
          <p className="text-base font-black leading-tight">Eki AI Automation</p>
          <p className="text-[11px] text-white/60 leading-tight">Control Center</p>
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
        <div className="px-5 py-6">
          <p className="text-lg font-black">Eki AI Automation</p>
          <p className="text-xs text-white/60">Control Center</p>
        </div>
        <nav className="mt-2 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold transition ${
                pathname.startsWith(item.href) ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="mt-6 px-3">
          <button
            onClick={signOut}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-white/60 hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* pt-16 on mobile clears the fixed top bar; md: removes it since the
          sidebar goes back to being a normal static flex sibling there. */}
      <main className="w-full flex-1 overflow-y-auto p-4 pt-20 md:p-8 md:pt-8">{children}</main>
    </div>
  );
}
