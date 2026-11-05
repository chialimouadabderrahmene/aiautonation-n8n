"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Piece, TARGET_LABEL } from "@/lib/home";

type BtnTone = "palm" | "leaf" | "ink" | "ghost" | "danger";

const BTN: Record<BtnTone, string> = {
  palm: "bg-palm text-white hover:bg-palm-deep",
  leaf: "bg-leaf text-white hover:bg-leaf-deep",
  ink: "bg-ink text-paper hover:bg-black",
  ghost: "bg-transparent text-ink border border-rule hover:border-ink",
  danger: "bg-berry-wash text-berry hover:bg-berry hover:text-white",
};

export function Btn({
  children, onClick, tone = "palm", disabled, type = "button", big, href, className = "",
}: {
  children: ReactNode; onClick?: () => void; tone?: BtnTone; disabled?: boolean; type?: "button" | "submit"; big?: boolean; href?: string; className?: string;
}) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${big ? "px-6 py-3.5 text-base" : "px-4 py-2 text-sm"} ${BTN[tone]} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls}>{children}</button>;
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-plantain" : "bg-slate-300"}`}
    >
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
    </button>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${active ? "border-ink bg-ink text-paper" : "border-rule bg-card text-ink-soft hover:border-ink hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

export const KIND_LABEL: Record<Piece["kind"], string> = { video: "Reel", carousel: "Carousel", post: "Post" };

export function PiecePreview({ piece, className = "" }: { piece: Piece; className?: string }) {
  if (piece.preview?.type === "video" && piece.preview.url) {
    return <video src={`${piece.preview.url}#t=0.5`} muted playsInline preload="metadata" className={`object-cover ${className}`} />;
  }
  if (piece.preview?.type === "image" && piece.preview.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={piece.preview.url} alt="" className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-plantain-wash text-[10px] font-bold uppercase tracking-wider text-ink-faint ${className}`}>
      {KIND_LABEL[piece.kind]}
    </div>
  );
}

/** One piece of content on the line. Everything on the line is one of these. */
export function Ticket({ piece, compact }: { piece: Piece; compact?: boolean }) {
  const making = piece.station === "making";
  return (
    <Link href={`/review/${piece.kind}/${piece.id}`} className="ticket rise block bg-card px-4 py-3 shadow-ticket transition hover:-translate-y-0.5 hover:bg-white">
      <div className="flex gap-3">
        <PiecePreview piece={piece} className="h-16 w-12 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-palm">{KIND_LABEL[piece.kind]}{piece.practice ? " · sample" : ""}</p>
          <p className={`mt-0.5 font-semibold leading-snug text-ink ${compact ? "line-clamp-1 text-sm" : "line-clamp-2 text-sm"}`}>{piece.title}</p>
          <p className="mt-1 text-xs text-ink-faint">{piece.stage}</p>
        </div>
      </div>
      {making ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-rule">
          <div className="h-full rounded-full bg-palm transition-all duration-700" style={{ width: `${Math.max(4, piece.progress)}%` }} />
        </div>
      ) : null}
      {!making && piece.destinations.length ? (
        <p className="mt-2 truncate border-t border-dashed border-rule pt-1.5 text-[11px] text-ink-faint">
          {piece.destinations.map((d) => TARGET_LABEL[d.target] ?? d.target).join(" · ")}
        </p>
      ) : null}
    </Link>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl font-bold sm:text-5xl">{title}</h1>
        {sub ? <p className="mt-2 max-w-2xl text-base text-ink-soft">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Banner({ tone = "plantain", children }: { tone?: "plantain" | "berry" | "leaf"; children: ReactNode }) {
  const t = { plantain: "bg-plantain-wash text-ink", berry: "bg-berry-wash text-berry", leaf: "bg-leaf-wash text-leaf-deep" }[tone];
  return <div className={`rounded-2xl px-4 py-3 text-sm ${t}`}>{children}</div>;
}

/** A phone, because that is where all of this ends up being seen. */
export function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[300px] rounded-[2.4rem] bg-ink p-2.5 shadow-lift">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[1.9rem] bg-slate-900">{children}</div>
    </div>
  );
}

export function money(usd: number): string {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: usd < 10 ? 2 : 0 });
}
