import { z } from "zod";
import { ProviderError } from "../lib/http";
import { chooseProvider } from "../lib/providers";
import { getBrandContext } from "../lib/brand";
import { reviewAgainstBrand } from "./critic";

const sceneSchema = z.object({
  index: z.number().int().min(0),
  visualPrompt: z.string().min(1).max(1000),
  voiceoverText: z.string().min(1).max(600),
  subtitleText: z.string().min(1).max(300),
  durationSec: z.number().min(2).max(10),
});

export const scriptSchema = z.object({
  hook: z.string().min(1),
  scenes: z.array(sceneSchema).min(1).max(15),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).max(15),
});

export type GeneratedScript = z.infer<typeof scriptSchema>;

export interface ScriptRequest {
  contentType: string;
  topic: string;
  prompt: string;
  audience?: string | null;
  language: string;
  tone: string;
  durationSec: number;
  aspectRatio: string;
  visualStyle: string;
  brand: string;
  cta?: string | null;
}

/**
 * Real OpenAI/Groq chat-completions call in JSON mode; the response is
 * validated with zod before the pipeline touches it. Scene lengths are kept
 * within what the video model can generate per clip (2–10 s).
 */
export interface BrandReview {
  reviewed: boolean;
  onBrand: boolean;
  score: number | null;
  violations: string[];
  corrected: boolean;
}

export async function generateScript(request: ScriptRequest): Promise<GeneratedScript & { provider: string; model: string; brandReview: BrandReview }> {
  const ai = await chooseProvider();
  const brand = await getBrandContext();
  const sceneCount = Math.max(3, Math.min(12, Math.round(request.durationSec / 6)));
  const systemPrompt = [
    "You write short-form video scripts for a real product marketing team.",
    "Return ONLY a JSON object — no markdown — with exactly this shape:",
    '{"hook":"...","scenes":[{"index":0,"visualPrompt":"...","voiceoverText":"...","subtitleText":"...","durationSec":6}],"caption":"...","hashtags":["#..."]}',
    `Produce exactly ${sceneCount} scenes, index 0..${sceneCount - 1}. Each durationSec is an integer between 4 and 8; together they sum to about ${request.durationSec}.`,
    "visualPrompt: a detailed shot description for an AI video model (subjects, setting, camera movement, lighting, style) — no on-screen text, no logos, no real people's names, max 900 characters.",
    "voiceoverText: what the narrator says during that scene; it must be speakable in the scene's duration (about 2.3 words per second).",
    "subtitleText: the on-screen caption for the scene (short, can be a trimmed voiceoverText).",
    "The last scene delivers the call to action. Never invent statistics, prices, dates, awards or testimonials that are not in the brief.",
    `Write voiceoverText, subtitleText and caption in this language: ${request.language}.`,
  ].join(" ");

  // The stored Brand Brain is the source of truth when configured; the
  // per-request brand/tone/audience fields still ride along as this one
  // video's own brief (topic-specific detail the stored profile won't have).
  const userPrompt = [
    brand.promptBlock,
    `Brand: ${request.brand}`,
    `Platform: ${request.contentType}`,
    `Topic: ${request.topic}`,
    `Brief: ${request.prompt}`,
    request.audience ? `Audience: ${request.audience}` : "",
    `Tone: ${request.tone}`,
    `Visual style: ${request.visualStyle}`,
    `Target duration: ${request.durationSec} seconds`,
    `Aspect ratio: ${request.aspectRatio}`,
    request.cta ? `Call to action: ${request.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { raw } = await ai.chatJSON({ system: systemPrompt, user: userPrompt, temperature: 0.7 });
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ProviderError("AI provider did not return valid JSON", null, true);
  }
  const parsed = scriptSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`AI script failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, null, true);
  }
  const scenes = parsed.data.scenes
    .sort((a, b) => a.index - b.index)
    .map((s, i) => ({ ...s, index: i, durationSec: Math.max(2, Math.min(10, Math.round(s.durationSec))) }));
  const draft = { ...parsed.data, scenes };

  const review = await reviewAgainstBrand(draft, brand, scriptSchema, "hook, scene voiceover/subtitle text, caption, hashtags");
  return { ...review.content, provider: ai.key, model: ai.model, brandReview: { reviewed: review.reviewed, onBrand: review.onBrand, score: review.score, violations: review.violations, corrected: review.corrected } };
}
