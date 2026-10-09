/**
 * Formats a BrandProfile/AudienceProfile into the same prompt block shape
 * worker/src/lib/brand.ts builds — duplicated here (not imported: api and
 * worker are separately deployed, same pattern already used for queue.ts)
 * because the API additionally needs to test a specific DRAFT profile by
 * id, not only "whichever one is active" (see testProfile.ts).
 */
import { prisma } from "../../lib/prisma";

export async function getBrandContext(brandId?: string, audienceId?: string): Promise<{ promptBlock: string }> {
  const [brand, audience] = await Promise.all([
    brandId ? prisma.brandProfile.findUnique({ where: { id: brandId } }) : prisma.brandProfile.findFirst({ where: { isActive: true } }),
    audienceId
      ? prisma.audienceProfile.findUnique({ where: { id: audienceId }, include: { vocabulary: true } })
      : prisma.audienceProfile.findFirst({ where: { isActive: true }, include: { vocabulary: true } }),
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
    if (audience.painPoints.length) lines.push(`- Their real pain points: ${audience.painPoints.join(" | ")}`);
    if (audience.objections.length) lines.push(`- Objections to pre-empt: ${audience.objections.join(" | ")}`);
    if (audience.vocabulary.length) lines.push(`- Vocabulary glossary: ${audience.vocabulary.map((v) => (v.meaning ? `${v.term} (${v.meaning})` : v.term)).join(", ")}`);
  }
  return { promptBlock: lines.join("\n") };
}
