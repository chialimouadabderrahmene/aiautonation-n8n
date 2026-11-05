import { prisma } from "./prisma";

// Identical rule lives in worker/src/lib/practice.ts — keep them in sync.

/**
 * Practice mode: the real engine and pipeline run but every paid or customer-facing call is
 * simulated, so a team can learn the product before connecting a single key. On until someone
 * deliberately goes live. If the flag cannot be read we stay in practice: a database hiccup
 * must never turn into a real send.
 */
export async function isPracticeMode(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "practiceMode" } });
    if (row) return row.value === true;
    return process.env.NODE_ENV !== "test";
  } catch {
    return process.env.NODE_ENV !== "test";
  }
}

/** Ofcom reserves +44 7700 900xxx for fiction, so a sample lead can never be a real person. */
export const PRACTICE_PHONE_PREFIX = "447700900";

export function practiceMessageId(kind: string): string {
  return `practice-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** One JSON answer that satisfies every AI-driven engine action, so autopilots run without a key. */
export const PRACTICE_AI_JSON = {
  posts: [
    { platform: "instagram", contentType: "caption", body: "[Practice sample] Miss the taste of home? Eki brings African foodstuff vendors to your phone.", hashtags: ["#Eki", "#AfricanFood"] },
    { platform: "x", contentType: "post", body: "[Practice sample] Real egusi, real palm oil, real vendors you can talk to. That is Eki.", hashtags: ["#Eki"] },
  ],
  hook: "[Practice sample] Stop hunting for real foodstuff.",
  caption: "[Practice sample] Eki connects you with vendors who know what good palm oil looks like.",
  hashtags: "#Eki #AfricanFood #Foodstuff",
  video_script: "[Practice sample] Open on a market stall. Cut to a delivery at the door. End on the Eki logo.",
  hooks: ["Question hooks about missing home food"],
  emotions: ["Nostalgia"],
  formats: ["Short vendor story"],
  items: [{ index: 1, persona: "buyer", category: "Trust", intensity: 6, keywords: ["fresh", "delivery"] }],
  top_hooks: ["Taste-of-home questions"],
  top_formats: ["Reels under 30 seconds"],
  top_emotions: ["Nostalgia"],
  recommendations: ["Show the vendor's face in the first three seconds"],
};
