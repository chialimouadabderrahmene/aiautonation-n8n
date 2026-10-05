/**
 * Brand Brain: CRUD + "one active profile at a time" for BrandProfile and
 * AudienceProfile (+ its VocabularyEntry rows). The actual AI generation and
 * prompt injection happen in the worker (worker/src/lib/brand.ts,
 * worker/src/pipeline/critic.ts) — this module only owns the data and the
 * admin-facing API. `recordAudit` already runs on every save from the
 * routes, so AuditLog is this model's change history; no separate version
 * table, `version` is just bumped on each update for an at-a-glance counter.
 */
import { prisma } from "../../lib/prisma";

export interface BrandProfileInput {
  name: string;
  voiceAdjectives: string[];
  tone: string | null;
  formality: string | null;
  sentenceStyle: string | null;
  preferredPhrases: string[];
  bannedWords: string[];
  ctaStyle: string | null;
  exampleSentences: string[];
}

export interface AudienceProfileInput {
  name: string;
  language: string | null;
  marketDescription: string | null;
  commonPhrases: string[];
  objections: string[];
  painPoints: string[];
}

export async function listBrandProfiles() {
  return prisma.brandProfile.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
}

export async function createBrandProfile(input: BrandProfileInput) {
  return prisma.brandProfile.create({ data: input });
}

export async function updateBrandProfile(id: string, input: Partial<BrandProfileInput>) {
  return prisma.brandProfile.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
}

export async function deleteBrandProfile(id: string) {
  await prisma.brandProfile.delete({ where: { id } });
}

/** Exactly one BrandProfile is active at a time. */
export async function setActiveBrandProfile(id: string) {
  await prisma.$transaction([
    prisma.brandProfile.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.brandProfile.update({ where: { id }, data: { isActive: true } }),
  ]);
}

export async function listAudienceProfiles() {
  return prisma.audienceProfile.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }], include: { vocabulary: true } });
}

export async function createAudienceProfile(input: AudienceProfileInput) {
  return prisma.audienceProfile.create({ data: input });
}

export async function updateAudienceProfile(id: string, input: Partial<AudienceProfileInput>) {
  return prisma.audienceProfile.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
}

export async function deleteAudienceProfile(id: string) {
  await prisma.audienceProfile.delete({ where: { id } });
}

export async function setActiveAudienceProfile(id: string) {
  await prisma.$transaction([
    prisma.audienceProfile.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.audienceProfile.update({ where: { id }, data: { isActive: true } }),
  ]);
}

export async function addVocabularyEntry(audienceProfileId: string, term: string, meaning: string | null, category: string | null) {
  return prisma.vocabularyEntry.create({ data: { audienceProfileId, term, meaning, category } });
}

export async function deleteVocabularyEntry(id: string) {
  await prisma.vocabularyEntry.delete({ where: { id } });
}

/** Read-only summary for the web UI's "what will actually be injected" preview — mirrors worker/src/lib/brand.ts's promptBlock without duplicating AI-call code in the API. */
export async function getEffectiveBrandContext() {
  const [brand, audience] = await Promise.all([
    prisma.brandProfile.findFirst({ where: { isActive: true } }),
    prisma.audienceProfile.findFirst({ where: { isActive: true }, include: { vocabulary: true } }),
  ]);
  return { brand, audience };
}
