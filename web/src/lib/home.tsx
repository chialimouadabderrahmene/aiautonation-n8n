"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, APIError } from "./api";

export type Station = "making" | "review" | "scheduled" | "posted" | "stopped";
export type PieceKind = "video" | "carousel" | "post";

export interface Piece {
  kind: PieceKind;
  id: string;
  title: string;
  station: Station;
  stage: string;
  progress: number;
  caption: string | null;
  practice: boolean;
  createdAt: string;
  preview: { type: "video" | "image"; url: string } | null;
  error: string | null;
  destinations: { target: string; status: string; url: string | null; scheduledFor: string | null; error: string | null }[];
}

export interface SetupStep {
  id: string;
  title: string;
  why: string;
  providers: string[];
  required: boolean;
  done: boolean;
  doneWith: string[];
}

export interface GuideStep {
  id: string;
  title: string;
  hint: string;
  href: string;
  done: boolean;
}

export interface HomeData {
  practice: boolean;
  stopped: boolean;
  line: Record<Station, Piece[]>;
  counts: Record<Station, number>;
  problems: { title: string; detail: string; href: string }[];
  week: { posted: number; made: number; leads: number; leadsTotal: number; replies: number; costUsd: number; newAccounts: number; newStores: number };
  system: { worker: string; queue: string; storage: string; ok: boolean };
  formats: { video: { ready: boolean; missing: string[] }; carousel: { ready: boolean; missing: string[] } };
  setup: { steps: SetupStep[]; done: number; total: number; canGoLive: boolean };
  autopilotsOn: number;
  guide: GuideStep[];
}

interface HomeContext {
  data: HomeData | null;
  error: string;
  refresh: () => Promise<void>;
}

/** Keeps the last answer between screens so moving around never flashes empty. */
let lastHome: HomeData | null = null;

const Ctx = createContext<HomeContext>({ data: null, error: "", refresh: async () => undefined });

export function HomeProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HomeData | null>(lastHome);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      lastHome = await api.get<HomeData>("/api/home");
      setData(lastHome);
      setError("");
    } catch (err) {
      setError(err instanceof APIError ? err.message : "Cannot reach Eki right now");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  return <Ctx.Provider value={{ data, error, refresh }}>{children}</Ctx.Provider>;
}

export const useHome = () => useContext(Ctx);

const TARGETS_BY_PROVIDER: Record<string, string[]> = { meta: ["instagram", "facebook"], x: ["x"], linkedin: ["linkedin"] };
export const TARGET_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", linkedin: "LinkedIn", twitter: "X" };

/** Where a new piece can go right now. Practice can "post" anywhere; live only to connected accounts. */
export function availableTargets(home: HomeData | null): string[] {
  if (!home) return [];
  if (home.practice) return ["instagram", "facebook", "x", "linkedin"];
  const social = home.setup.steps.find((s) => s.id === "social");
  return (social?.doneWith ?? []).flatMap((p) => TARGETS_BY_PROVIDER[p] ?? []);
}

export interface MakeRequest {
  format: "video" | "carousel";
  idea: string;
  targets: string[];
  audience?: string;
  tone?: string;
  durationSec?: number;
  language?: string;
  cta?: string;
  visualStyle?: string;
  slideCount?: number;
}

/** Starts a real job and returns where to watch it. */
export async function makePiece(req: MakeRequest): Promise<string> {
  const name = req.idea.length > 60 ? `${req.idea.slice(0, 57)}...` : req.idea;
  const shared = {
    name,
    topic: req.idea.slice(0, 300),
    prompt: req.idea.slice(0, 2000),
    publishTargets: req.targets,
    ...(req.audience ? { audience: req.audience } : {}),
    ...(req.tone ? { tone: req.tone } : {}),
    ...(req.language ? { language: req.language } : {}),
    ...(req.cta ? { cta: req.cta } : {}),
  };
  if (req.format === "video") {
    const r = await api.post<{ job: { id: string } }>("/api/video/projects", {
      ...shared,
      contentType: "Instagram Reel",
      durationSec: req.durationSec ?? 30,
      ...(req.visualStyle ? { visualStyle: req.visualStyle } : {}),
    });
    return `/review/video/${r.job.id}`;
  }
  const r = await api.post<{ job: { id: string } }>("/api/carousel/projects", { ...shared, slideCount: req.slideCount ?? 6 });
  return `/review/carousel/${r.job.id}`;
}
