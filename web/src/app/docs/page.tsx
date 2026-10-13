"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { BookIcon, BoltIcon, PuzzleIcon } from "@/components/icons";
import DocsShell from "./DocsShell";
import { DOC_NAV } from "./content";

const FEATURED = [
  { slug: "getting-started", title: "Quickstart", blurb: "Connect your first app and activate a workflow in under five minutes.", icon: BoltIcon },
  { slug: "workflow-engine", title: "Workflow Engine", blurb: "Triggers, actions, retries, scheduling — how a run actually executes.", icon: PuzzleIcon },
  { slug: "api-reference", title: "Admin API reference", blurb: "Every authenticated endpoint this Control Center exposes.", icon: BookIcon },
];

export default function DocsIndexPage() {
  return (
    <DocsShell>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Documentation</h1>
        <p className="mt-1 text-sm text-slate-500">Everything you need to run the AI Automation platform — real endpoints, real behavior, no n8n required.</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FEATURED.map((f) => (
          <Link key={f.slug} href={`/docs/${f.slug}`}>
            <Card className="h-full transition hover:border-brand-400 hover:shadow-md">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <f.icon size={16} />
              </span>
              <p className="mt-3 font-bold text-slate-900">{f.title}</p>
              <p className="mt-1 text-sm text-slate-500">{f.blurb}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-8 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Base URL</span>
        <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-brand-700">{"https://<your-domain>/api"}</code>
      </div>

      {DOC_NAV.map((section) => (
        <div key={section.label} className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{section.label}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {section.items.map((item) => (
              <Link key={item.slug} href={`/docs/${item.slug}`}>
                <Card className="h-full transition hover:border-brand-400">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.blurb}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </DocsShell>
  );
}
