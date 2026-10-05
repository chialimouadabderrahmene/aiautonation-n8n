import { Router } from "express";
import { z } from "zod";
import { AuthedRequest } from "../modules/auth/auth";
import { recordAudit } from "../modules/audit/audit";
import * as brand from "../modules/brand/service";

export const brandRouter = Router();

const stringArray = z.array(z.string().trim().min(1).max(300)).max(100);

const brandProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  voiceAdjectives: stringArray.default([]),
  tone: z.string().trim().max(200).nullable().optional(),
  formality: z.string().trim().max(200).nullable().optional(),
  sentenceStyle: z.string().trim().max(500).nullable().optional(),
  preferredPhrases: stringArray.default([]),
  bannedWords: stringArray.default([]),
  ctaStyle: z.string().trim().max(200).nullable().optional(),
  exampleSentences: stringArray.default([]),
});

const audienceProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  language: z.string().trim().max(100).nullable().optional(),
  marketDescription: z.string().trim().max(1000).nullable().optional(),
  commonPhrases: stringArray.default([]),
  objections: stringArray.default([]),
  painPoints: stringArray.default([]),
});

const vocabularyEntrySchema = z.object({
  term: z.string().trim().min(1).max(200),
  meaning: z.string().trim().max(500).nullable().optional(),
  category: z.enum(["slang", "product", "painPoint", "objection", "other"]).nullable().optional(),
});

brandRouter.get("/context", async (_req, res) => {
  res.json(await brand.getEffectiveBrandContext());
});

brandRouter.get("/profiles", async (_req, res) => {
  res.json(await brand.listBrandProfiles());
});

brandRouter.post("/profiles", async (req: AuthedRequest, res) => {
  const parsed = brandProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const row = await brand.createBrandProfile({ ...parsed.data, tone: parsed.data.tone ?? null, formality: parsed.data.formality ?? null, sentenceStyle: parsed.data.sentenceStyle ?? null, ctaStyle: parsed.data.ctaStyle ?? null });
  await recordAudit(req.admin?.email ?? "unknown", "brand.profile.created", "BrandProfile", row.id);
  res.status(201).json(row);
});

brandRouter.put("/profiles/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = brandProfileSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const row = await brand.updateBrandProfile(id, parsed.data);
  await recordAudit(req.admin?.email ?? "unknown", "brand.profile.updated", "BrandProfile", id);
  res.json(row);
});

brandRouter.delete("/profiles/:id", async (req: AuthedRequest, res) => {
  await brand.deleteBrandProfile(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "brand.profile.deleted", "BrandProfile", String(req.params.id));
  res.json({ ok: true });
});

brandRouter.post("/profiles/:id/activate", async (req: AuthedRequest, res) => {
  await brand.setActiveBrandProfile(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "brand.profile.activated", "BrandProfile", String(req.params.id));
  res.json({ ok: true });
});

brandRouter.get("/audiences", async (_req, res) => {
  res.json(await brand.listAudienceProfiles());
});

brandRouter.post("/audiences", async (req: AuthedRequest, res) => {
  const parsed = audienceProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const row = await brand.createAudienceProfile({ ...parsed.data, language: parsed.data.language ?? null, marketDescription: parsed.data.marketDescription ?? null });
  await recordAudit(req.admin?.email ?? "unknown", "brand.audience.created", "AudienceProfile", row.id);
  res.status(201).json(row);
});

brandRouter.put("/audiences/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = audienceProfileSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const row = await brand.updateAudienceProfile(id, parsed.data);
  await recordAudit(req.admin?.email ?? "unknown", "brand.audience.updated", "AudienceProfile", id);
  res.json(row);
});

brandRouter.delete("/audiences/:id", async (req: AuthedRequest, res) => {
  await brand.deleteAudienceProfile(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "brand.audience.deleted", "AudienceProfile", String(req.params.id));
  res.json({ ok: true });
});

brandRouter.post("/audiences/:id/activate", async (req: AuthedRequest, res) => {
  await brand.setActiveAudienceProfile(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "brand.audience.activated", "AudienceProfile", String(req.params.id));
  res.json({ ok: true });
});

brandRouter.post("/audiences/:id/vocabulary", async (req: AuthedRequest, res) => {
  const parsed = vocabularyEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const row = await brand.addVocabularyEntry(String(req.params.id), parsed.data.term, parsed.data.meaning ?? null, parsed.data.category ?? null);
  await recordAudit(req.admin?.email ?? "unknown", "brand.vocabulary.added", "AudienceProfile", String(req.params.id), { term: parsed.data.term });
  res.status(201).json(row);
});

brandRouter.delete("/vocabulary/:id", async (req: AuthedRequest, res) => {
  await brand.deleteVocabularyEntry(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "brand.vocabulary.deleted", "VocabularyEntry", String(req.params.id));
  res.json({ ok: true });
});
