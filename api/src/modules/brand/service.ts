/**
 * Brand Brain: CRUD + "one active profile at a time" for BrandProfile and
 * AudienceProfile (+ its VocabularyEntry rows), plus version history and
 * rollback via ProfileVersion (one table for both kinds). The actual AI
 * generation and prompt injection happen in the worker
 * (worker/src/lib/brand.ts, worker/src/pipeline/critic.ts) — this module
 * only owns the data and the admin-facing API.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

async function snapshotVersion(profileType: "brand" | "audience", profileId: string, before: unknown, createdBy: string) {
  await prisma.profileVersion.create({ data: { profileType, profileId, snapshot: before as object, createdBy } });
}

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

export async function updateBrandProfile(id: string, input: Partial<BrandProfileInput>, actor: string) {
  const before = await prisma.brandProfile.findUniqueOrThrow({ where: { id } });
  await snapshotVersion("brand", id, before, actor);
  return prisma.brandProfile.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
}

export async function listBrandProfileVersions(id: string) {
  return prisma.profileVersion.findMany({ where: { profileType: "brand", profileId: id }, orderBy: { createdAt: "desc" }, take: 50 });
}

/** Restores a BrandProfile to a prior snapshot — itself snapshotted first, so a rollback is never a one-way trip. */
export async function rollbackBrandProfile(id: string, versionId: string, actor: string) {
  const version = await prisma.profileVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (version.profileType !== "brand" || version.profileId !== id) throw new Error("Version does not belong to this profile");
  const before = await prisma.brandProfile.findUniqueOrThrow({ where: { id } });
  await snapshotVersion("brand", id, before, actor);
  const snap = version.snapshot as Record<string, unknown>;
  const { id: _id, createdAt: _c, updatedAt: _u, isActive: _a, ...restorable } = snap;
  return prisma.brandProfile.update({ where: { id }, data: { ...restorable, version: { increment: 1 } } as Prisma.BrandProfileUpdateInput });
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

export async function updateAudienceProfile(id: string, input: Partial<AudienceProfileInput>, actor: string) {
  const before = await prisma.audienceProfile.findUniqueOrThrow({ where: { id } });
  await snapshotVersion("audience", id, before, actor);
  return prisma.audienceProfile.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
}

export async function listAudienceProfileVersions(id: string) {
  return prisma.profileVersion.findMany({ where: { profileType: "audience", profileId: id }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function rollbackAudienceProfile(id: string, versionId: string, actor: string) {
  const version = await prisma.profileVersion.findUniqueOrThrow({ where: { id: versionId } });
  if (version.profileType !== "audience" || version.profileId !== id) throw new Error("Version does not belong to this profile");
  const before = await prisma.audienceProfile.findUniqueOrThrow({ where: { id } });
  await snapshotVersion("audience", id, before, actor);
  const snap = version.snapshot as Record<string, unknown>;
  const { id: _id, createdAt: _c, updatedAt: _u, isActive: _a, ...restorable } = snap;
  return prisma.audienceProfile.update({ where: { id }, data: { ...restorable, version: { increment: 1 } } as Prisma.AudienceProfileUpdateInput });
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
