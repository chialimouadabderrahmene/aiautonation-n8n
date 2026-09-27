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

  useEffect(() => {
    if (!hasToken()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 bg-brand-700 text-white">
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
            onClick={() => {
              clearToken();
              router.push("/login");
            }}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-white/60 hover:bg-white/10 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
