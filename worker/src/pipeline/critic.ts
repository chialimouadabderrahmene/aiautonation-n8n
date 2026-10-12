/**
 * Brand voice / audience vocabulary critic — the second AI pass the Brand
 * Brain spec calls for: generate -> critic checks against the stored
 * profile -> rewrite if needed -> final. Shared by video scripts
 * (script.ts) and carousel slide copy (slides.ts) — both pass their
 * generated JSON through this, typed by their own zod schema, so this stays
 * one implementation instead of two near-identical ones.
 *
 * With no active brand/audience profile configured, this is a no-op: it
 * returns the original content unreviewed (never blocks content on an empty
 * Brand Brain — the admin may not have filled one in yet).
 */
import { z } from "zod";
import { ProviderError } from "../lib/http";
import { chooseProvider } from "../lib/providers";
import { BrandContext } from "../lib/brand";

export interface CriticResult<T> {
  content: T;
  reviewed: boolean;
  onBrand: boolean;
  score: number | null;
  violations: string[];
  corrected: boolean;
}

const criticResponseSchema = z.object({
  score: z.number().min(0).max(100),
  onBrand: z.boolean(),
  violations: z.array(z.string()).max(20),
  /** Present only when the critic made a correction; same shape as the input. */
  corrected: z.unknown().optional(),
});

/**
 * Reviews `content` (already-validated JSON from a generator) against the
 * active brand voice + audience vocabulary. If it drifts — generic phrasing,
 * wrong register, a banned word, missed audience vocabulary — asks the same
 * AI call to return a corrected version, re-validated with `schema` before
 * it's trusted (a corrected version that fails validation is discarded; the
 * original ships with the violation recorded instead of nothing at all).
 */
export async function reviewAgainstBrand<T>(content: T, brand: BrandContext, schema: z.ZodType<T>, textFieldsHint: string): Promise<CriticResult<T>> {
  if (!brand.brandProfile && !brand.audienceProfile) {
    return { content, reviewed: false, onBrand: true, score: null, violations: [], corrected: false };
  }

  const hardViolations = findBannedWords(content, brand.bannedWords);

  const ai = await chooseProvider();
  const systemPrompt = [
    "You are a strict brand-voice and audience-vocabulary editor reviewing AI-generated marketing content before a human approves it.",
    "Score it 0-100 for how well it matches the brand voice and uses the audience's own vocabulary (not generic marketing phrasing).",
    "List every concrete violation (a banned word used, a generic phrase where the brand has a preferred one, missed audience vocabulary, wrong tone).",
    "If score < 80 or there is any violation, rewrite the content to fix it — keep the exact same JSON shape and field names as the input, change only the words.",
    "Never invent new claims, numbers, prices, or facts while rewriting — only adjust voice and vocabulary.",
    'Return ONLY a JSON object: {"score": 0-100, "onBrand": boolean, "violations": ["..."], "corrected": <same shape as input, or omit if no rewrite was needed>}',
  ].join(" ");
  const userPrompt = [brand.promptBlock, "", `Content to review (${textFieldsHint}):`, JSON.stringify(content, null, 2)].filter(Boolean).join("\n");

  try {
    const { raw } = await ai.chatJSON({ system: systemPrompt, user: userPrompt, temperature: 0.3, timeoutMs: 60_000 });
    const parsed = criticResponseSchema.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    if (!parsed.success) throw new ProviderError("Critic pass did not return valid JSON", null, true);

    const violations = [...new Set([...hardViolations, ...parsed.data.violations])];
    let finalContent = content;
    let corrected = false;
    if (parsed.data.corrected !== undefined) {
      const reparsed = schema.safeParse(parsed.data.corrected);
      if (reparsed.success) {
        finalContent = reparsed.data;
        corrected = true;
      }
      // A corrected version that fails validation is silently discarded — the
      // original ships, with the violation still recorded, rather than risk
      // shipping malformed content.
    }
    return { content: finalContent, reviewed: true, onBrand: parsed.data.onBrand && hardViolations.length === 0, score: parsed.data.score, violations, corrected };
  } catch {
    // The critic pass is a quality gate, not a hard dependency: if it fails
    // (provider error, bad JSON), the original content still ships — flagged
    // as unreviewed rather than silently claimed "on brand".
    return { content, reviewed: false, onBrand: hardViolations.length === 0, score: null, violations: hardViolations, corrected: false };
  }
}

function findBannedWords(content: unknown, bannedWords: string[]): string[] {
  if (!bannedWords.length) return [];
  const text = JSON.stringify(content).toLowerCase();
  return bannedWords.filter((w) => text.includes(w));
}
