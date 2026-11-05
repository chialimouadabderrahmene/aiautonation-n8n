"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ControlCenterLayout from "@/components/ControlCenterLayout";
import { PageTitle } from "@/components/kit";
import { api } from "@/lib/api";

const GROUPS: { title: string; links: { name: string; desc: string; href: string }[] }[] = [
  {
    title: "Numbers",
    links: [
      { name: "Results", desc: "Posts, runs, approvals and what it all cost.", href: "/reports" },
      { name: "Run history", desc: "Every job that ran, with times and errors.", href: "/executions" },
    ],
  },
  {
    title: "Content",
    links: [
      { name: "All reels", desc: "Every reel with its full settings.", href: "/video" },
      { name: "All carousels", desc: "Every carousel with its slides.", href: "/carousels" },
      { name: "Post drafts", desc: "Text drafts written by the autopilots.", href: "/workflow-engine/content-drafts" },
      { name: "Brand brain", desc: "Voice, audiences and vocabulary in full detail.", href: "/brand-brain" },
    ],
  },
  {
    title: "Automation",
    links: [
      { name: "Workflows", desc: "The steps inside each autopilot, with version history.", href: "/workflow-engine" },
      { name: "Workflow runs", desc: "Step-by-step logs, replays and failures.", href: "/workflow-engine/executions" },
      { name: "WhatsApp contacts", desc: "The contact list and listings behind WhatsApp.", href: "/whatsapp" },
    ],
  },
  {
    title: "Accounts",
    links: [
      { name: "All integrations", desc: "Every provider with its technical status.", href: "/integrations" },
      { name: "Social accounts", desc: "Post to several accounts on one platform.", href: "/connected-accounts" },
      { name: "Settings", desc: "Team members, defaults, safety and business details.", href: "/settings" },
      { name: "Documentation", desc: "Technical guides for your developer.", href: "/docs" },
    ],
  },
];

interface Health { [name: string]: { status: string; message: string } }

const NAMES: Record<string, string> = { api: "App server", database: "Database", redis: "Queue", worker: "Studio (worker)", storage: "Media storage" };

export default function BackOfficePage() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    void api.get<Health>("/api/system/health").then(setHealth).catch(() => undefined);
  }, []);

  return (
    <ControlCenterLayout>
      <PageTitle title="Back office" sub="The detail behind everything. Day to day you should not need this page." />
      <section className="mb-8 rounded-3xl bg-card p-6 shadow-ticket">
        <h2 className="text-xl font-bold">Is everything running?</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(NAMES).map(([key, label]) => {
            const h = health?.[key];
            const ok = h?.status === "ONLINE" || h?.status === "DEGRADED";
            return (
              <li key={key} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${!h ? "bg-slate-300" : ok ? "bg-leaf" : "bg-berry"}`} aria-hidden />
                <span><strong>{label}</strong>{h ? <span className="block text-xs text-ink-faint">{h.message}</span> : null}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="grid gap-8 md:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-lg font-bold">{g.title}</h2>
            <ul className="space-y-2">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block rounded-2xl bg-card p-4 shadow-ticket transition hover:-translate-y-0.5">
                    <span className="font-semibold">{l.name}</span>
                    <span className="block text-sm text-ink-faint">{l.desc}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ControlCenterLayout>
  );
}
