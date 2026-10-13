"use client";

import { notFound, useParams } from "next/navigation";
import DocsShell from "../DocsShell";
import { DOC_CONTENT, DOC_FLAT } from "../content";

export default function DocPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const meta = DOC_FLAT.find((d) => d.slug === slug);
  const body = DOC_CONTENT[slug];
  if (!meta || !body) return notFound();

  return (
    <DocsShell>
      <article className="max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900">{meta.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{meta.blurb}</p>
        <div className="mt-6 border-t border-slate-100 pt-2">{body}</div>
      </article>
    </DocsShell>
  );
}
