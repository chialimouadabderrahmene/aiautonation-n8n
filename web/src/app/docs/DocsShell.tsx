"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { DOC_NAV } from "./content";

export default function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ControlCenterLayout>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <nav className="space-y-5 lg:sticky lg:top-8 lg:self-start">
          <Link href="/docs" className="block text-sm font-bold text-slate-900">
            Documentation
          </Link>
          {DOC_NAV.map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const href = `/docs/${item.slug}`;
                  const active = pathname === href;
                  return (
                    <Link
                      key={item.slug}
                      href={href}
                      className={`block rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {item.title}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </ControlCenterLayout>
  );
}
