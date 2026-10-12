/**
 * Content multiplication — native port of n8n workflow 18 ("Content
 * Multiplication Engine"). Takes one content idea, asks the configured AI
 * provider to expand it into every format n8n's version did, and queues
 * each as a `ContentVariant` row for the team to pick from — a flat
 * review list, not a new approval pipeline (nothing downstream consumes
 * these automatically, same terminal scope as n8n's "queue to sheet").
 *
 * Prompt text is n8n's own, unchanged (same "never invent statistics/
 * testimonials/prices/guarantees" instruction) — this reuses the shared
 * AIProvider abstraction (worker/src/lib/providers/) instead of n8n's
 * direct Groq-only HTTP call, so it works with whichever provider the
 * admin has selected in Settings, same as script/slide generation.
 */
import { prisma } from "../lib/prisma";
import { chooseProvider } from "../lib/providers";
import { ProviderError } from "../lib/http";

interface MultipliedContent {
  reel_script?: string;
  tiktok_adaptation?: string;
  carousel?: string[];
  story_sequence?: string[];
  fb_post?: string;
  hook_variations?: string[];
  caption_variations?: string[];
}

function parseAiJson(raw: string): MultipliedContent {
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ProviderError("AI provider did not return valid JSON", null, true);
  }
  return json as MultipliedContent;
}

/** Pure — mirrors n8n's "Build Queue Rows": flattens the AI's output into one row per format, numbering array variants. */
export function buildContentVariantRows(idea: string, d: MultipliedContent): { idea: string; format: string; content: string }[] {
  const rows: { idea: string; format: string; content: string }[] = [];
  const add = (format: string, v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v.map((x, i) => `${i + 1}. ${String(x).trim()}`).join("\n") : String(v ?? "").trim();
    if (s) rows.push({ idea, format, content: s });
  };
  add("reel_script", d.reel_script);
  add("tiktok_adaptation", d.tiktok_adaptation);
  add("carousel", d.carousel);
  add("story_sequence", d.story_sequence);
  add("fb_post", d.fb_post);
  (d.hook_variations ?? []).forEach((h, i) => add(`hook_variation_${i + 1}`, h));
  (d.caption_variations ?? []).forEach((c, i) => add(`caption_variation_${i + 1}`, c));
  return rows;
}

export async function multiplyContent(idea: string): Promise<{ variantsCreated: number }> {
  const ai = await chooseProvider();
  const system =
    "You are a content strategist for Eki, a marketplace connecting African foodstuff vendors with buyers worldwide. Do not invent statistics, testimonials, prices or guarantees. Return ONLY JSON.";
  const user = [
    "Take this content idea and expand it into ALL formats. Return JSON with: reel_script (60s, string), tiktok_adaptation (45s, string),",
    "carousel (array of 5 slide strings), story_sequence (array of 3 frame strings), fb_post (string), hook_variations (array of 3 strings), caption_variations (array of 3 strings).",
    `Idea: ${idea}`,
  ].join(" ");

  const { raw } = await ai.chatJSON({ system, user, temperature: 0.7 });
  const parsed = parseAiJson(raw);
  const rows = buildContentVariantRows(idea, parsed);
  if (rows.length) await prisma.contentVariant.createMany({ data: rows });
  return { variantsCreated: rows.length };
}
