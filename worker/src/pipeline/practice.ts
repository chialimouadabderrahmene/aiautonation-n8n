import fs from "node:fs/promises";
import { run } from "../lib/ffmpeg";
import { AIProvider, ChatJSONRequest, ChatJSONResult } from "../lib/providers/types";

/**
 * Stand-ins used only in Practice mode, so the whole pipeline really runs (real files, real
 * ffmpeg, real quality check) with no API keys and no cost. Copy is deliberately generic and
 * invents no statistics, prices or testimonials.
 */

function readTopic(user: string): string {
  const match = /^Topic:\s*(.+)$/m.exec(user);
  return (match?.[1] ?? "African foodstuff, delivered").trim().slice(0, 140);
}

function readCount(system: string, noun: "scenes" | "slides", fallback: number): number {
  const match = new RegExp(`exactly (\\d+) ${noun}`).exec(system);
  return match ? Number(match[1]) : fallback;
}

const VIDEO_LINES = [
  "Finding real African foodstuff abroad should not feel like a treasure hunt.",
  "Eki brings the vendors you trust and the food you grew up with into one place.",
  "Browse, ask questions, and order from people who know what good palm oil looks like.",
  "Vendors get a storefront of their own. Buyers get the taste of home.",
  "Eki keeps it simple, from the first message to the delivery at your door.",
];

const SHOTS = [
  "Warm close-up of a market stall with egusi, ogbono and crayfish in woven baskets, slow dolly in.",
  "A vendor packing an order of yam flour and palm oil in a bright kitchen, handheld, soft morning light.",
  "A customer in a UK flat opening a delivery box and smiling, shallow depth of field.",
  "Hands stirring a pot of soup over a stove, steam rising, golden light.",
  "A phone showing a clean storefront, placed beside fresh peppers on a wooden table.",
];

function practiceScript(system: string, user: string) {
  const topic = readTopic(user);
  const count = readCount(system, "scenes", 4);
  const scenes = Array.from({ length: count }, (_, index) => {
    const isFirst = index === 0;
    const isLast = index === count - 1;
    const line = isFirst ? `${topic}. Here is what you need to know.` : isLast ? "Join Eki today. Your people, your food, one tap away." : VIDEO_LINES[(index - 1) % VIDEO_LINES.length]!;
    return { index, visualPrompt: SHOTS[index % SHOTS.length]!, voiceoverText: line, subtitleText: line, durationSec: 5 };
  });
  return {
    hook: `${topic}. Here is what you need to know.`,
    scenes,
    caption: `[Practice sample] ${topic}. Eki connects African foodstuff vendors with buyers who miss the taste of home.`,
    hashtags: ["#Eki", "#AfricanFood", "#Foodstuff", "#Diaspora"],
  };
}

const SLIDE_COPY = [
  { headline: "", body: "A quick guide from Eki" },
  { headline: "It should not be this hard", body: "Real foodstuff abroad means long trips, guesswork and unanswered messages." },
  { headline: "Meet the vendors", body: "Eki puts trusted African foodstuff vendors in one place you can browse." },
  { headline: "Ask before you buy", body: "Talk to the vendor, check what is in stock and agree delivery that suits you." },
  { headline: "Vendors win too", body: "A storefront of your own, without chasing orders across chat threads." },
  { headline: "Ready when you are", body: "Open Eki and find the taste of home." },
];

function practiceSlides(system: string, user: string) {
  const topic = readTopic(user);
  const count = readCount(system, "slides", 6);
  const slides = Array.from({ length: count }, (_, index) => {
    const copy = index === count - 1 ? SLIDE_COPY[SLIDE_COPY.length - 1]! : SLIDE_COPY[index % (SLIDE_COPY.length - 1)]!;
    return { index, headline: index === 0 ? topic.slice(0, 80) : copy.headline, body: copy.body, visualDirection: "Warm market colours with bold type." };
  });
  return {
    slides,
    caption: `[Practice sample] ${topic}. Save this for later and share it with someone who misses home food.`,
    hashtags: ["#Eki", "#AfricanFood", "#Foodstuff", "#Diaspora"],
  };
}

/** Answers every prompt the pipeline sends, by the JSON shape that prompt asks for. */
export const practiceProvider: AIProvider = {
  key: "practice",
  model: "practice-sample",
  async chatJSON(req: ChatJSONRequest): Promise<ChatJSONResult> {
    let body: unknown;
    if (req.system.includes('"scenes"')) body = practiceScript(req.system, req.user);
    else if (req.system.includes('"slides"')) body = practiceSlides(req.system, req.user);
    else if (/onBrand/.test(req.system)) body = { score: 90, onBrand: true, violations: [] };
    else body = { posts: [{ platform: "instagram", contentType: "caption", body: "[Practice sample] Real African foodstuff, from vendors you can talk to.", hashtags: ["#Eki"] }] };
    return { raw: JSON.stringify(body), provider: "practice", model: "practice-sample" };
  },
};

/** A quiet two-note pad instead of a paid voice-over, timed like real narration. */
export async function practiceVoice(text: string, dest: string): Promise<void> {
  const seconds = Math.max(2, Math.min(9, text.split(/\s+/).length / 2.3));
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `aevalsrc='0.05*sin(2*PI*196*t)+0.04*sin(2*PI*293.66*t):s=44100:d=${seconds.toFixed(2)}'`,
    "-af", `afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, seconds - 0.4).toFixed(2)}:d=0.4`,
    "-c:a", "libmp3lame", "-b:a", "96k", dest,
  ], 60_000);
}

const PALETTES = [
  ["0xE4572E", "0xF2A541", "0x2A1A12"],
  ["0x1F7A4D", "0xF2A541", "0x12261C"],
  ["0xB23A48", "0xE4572E", "0x2A1A12"],
  ["0xF2A541", "0xE4572E", "0x3B2314"],
];

/** A moving colour field in Eki's palette instead of a paid AI video clip. */
export async function practiceClip(sceneIndex: number, durationSec: number, aspectRatio: string, dest: string): Promise<void> {
  const [c0, c1, c2] = PALETTES[sceneIndex % PALETTES.length]!;
  const size = aspectRatio === "16:9" ? "1280x720" : "720x1280";
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `gradients=s=${size}:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:speed=0.012:r=24:d=${durationSec}`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", dest,
  ], 120_000);
  await fs.stat(dest);
}
