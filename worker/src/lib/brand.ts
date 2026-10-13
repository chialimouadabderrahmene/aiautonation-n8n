/**
 * Brand Brain context loader — worker side.
 *
 * NOTE: duplicated in api/src/modules/brand/loader.ts (separately deployed
 * services, same pattern already used for the BullMQ queue defs in
 * lib/queue.ts) — keep the two in sync.
 *
 * Reads the one active BrandProfile and the one active AudienceProfile (plus
 * its VocabularyEntry rows) and turns them into a compact prompt block, so
 * every script/slide-copy generation call gets the brand's voice and the
 * audience's own vocabulary automatically — nobody retypes it per request.
 * `isActive` is unique-in-intent (service.ts's setActive() clears the others
 * on every change), so "the active one" is always well defined; no rows yet
 * is a valid, empty state (new install, nothing configured).
 */
import { prisma } from "./prisma";

export interface BrandContext {
  brandProfile: { name: string; voiceAdjectives: string[]; tone: string | null; formality: string | null; sentenceStyle: string | null; preferredPhrases: string[]; bannedWords: string[]; ctaStyle: string | null; exampleSentences: string[] } | null;
  audienceProfile: { name: string; language: string | null; marketDescription: string | null; commonPhrases: string[]; objections: string[]; painPoints: string[] } | null;
  vocabulary: { term: string; meaning: string | null; category: string | null }[];
  /** Ready-to-inject block for a system/user prompt. Empty string if nothing is configured yet. */
  promptBlock: string;
  /** Lower-cased banned words, for the critic's hard check. */
  bannedWords: string[];
}

export async function getBrandContext(): Promise<BrandContext> {
  const [brand, audience] = await Promise.all([
    prisma.brandProfile.findFirst({ where: { isActive: true } }),
    prisma.audienceProfile.findFirst({ where: { isActive: true }, include: { vocabulary: true } }),
  ]);

  const lines: string[] = [];
  if (brand) {
    lines.push("BRAND VOICE (follow this exactly — do not default to generic marketing copy):");
    if (brand.voiceAdjectives.length) lines.push(`- Voice: ${brand.voiceAdjectives.join(", ")}`);
    if (brand.tone) lines.push(`- Tone: ${brand.tone}`);
    if (brand.formality) lines.push(`- Formality: ${brand.formality}`);
    if (brand.sentenceStyle) lines.push(`- Sentence style: ${brand.sentenceStyle}`);
    if (brand.preferredPhrases.length) lines.push(`- Use phrases like: ${brand.preferredPhrases.join(" | ")}`);
    if (brand.bannedWords.length) lines.push(`- NEVER use these words/phrases: ${brand.bannedWords.join(", ")}`);
    if (brand.ctaStyle) lines.push(`- CTA style: ${brand.ctaStyle}`);
    if (brand.exampleSentences.length) lines.push(`- Examples of the voice done right:\n  "${brand.exampleSentences.join('"\n  "')}"`);
  }
  if (audience) {
    lines.push("AUDIENCE VOCABULARY (use the audience's own words, not corporate paraphrases):");
    if (audience.language) lines.push(`- Language/register: ${audience.language}`);
    if (audience.marketDescription) lines.push(`- Who they are: ${audience.marketDescription}`);
    if (audience.commonPhrases.length) lines.push(`- Phrases they actually use: ${audience.commonPhrases.join(" | ")}`);
    if (audience.painPoints.length) lines.push(`- Their real pain points (lead with these, don't invent others): ${audience.painPoints.join(" | ")}`);
    if (audience.objections.length) lines.push(`- Objections to pre-empt: ${audience.objections.join(" | ")}`);
    if (audience.vocabulary.length) lines.push(`- Vocabulary glossary: ${audience.vocabulary.map((v) => (v.meaning ? `${v.term} (${v.meaning})` : v.term)).join(", ")}`);
  }

  return {
    brandProfile: brand
      ? { name: brand.name, voiceAdjectives: brand.voiceAdjectives, tone: brand.tone, formality: brand.formality, sentenceStyle: brand.sentenceStyle, preferredPhrases: brand.preferredPhrases, bannedWords: brand.bannedWords, ctaStyle: brand.ctaStyle, exampleSentences: brand.exampleSentences }
      : null,
    audienceProfile: audience
      ? { name: audience.name, language: audience.language, marketDescription: audience.marketDescription, commonPhrases: audience.commonPhrases, objections: audience.objections, painPoints: audience.painPoints }
      : null,
    vocabulary: audience?.vocabulary.map((v) => ({ term: v.term, meaning: v.meaning, category: v.category })) ?? [],
    promptBlock: lines.join("\n"),
    bannedWords: (brand?.bannedWords ?? []).map((w) => w.toLowerCase()),
  };
}
