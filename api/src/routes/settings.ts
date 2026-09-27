import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const settingsRouter = Router();

/** Known setting keys. Boolean ones feed the readiness engine (see
 * modules/workflows/manifest.ts, "setting:<key>") — they exist because some
 * requirements (Meta template approval, a real feedback form URL) cannot be
 * verified by an API call, only confirmed by a human. Everything else here
 * is a Video Generator default. */
const DEFAULTS: Record<string, unknown> = {
  whatsappTemplatesApproved: false,
  autopilotSocialPostingEnabled: false,
  feedbackFormConfigured: false,
  defaultAiProvider: "groq",
  defaultVideoProvider: "runway",
  defaultVoiceProvider: "elevenlabs",
  defaultLanguage: "en",
  defaultTone: "Professional",
  defaultDurationSec: 30,
  defaultAspectRatio: "9:16",
  maxRetries: 2,
};

settingsRouter.get("/", async (_req, res) => {
  const rows = await prisma.setting.findMany();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ ...DEFAULTS, ...byKey });
});

const setSchema = z.object({ value: z.unknown() });

settingsRouter.put("/:key", async (req: AuthedRequest, res) => {
  const key = req.params.key as string;
  if (!(key in DEFAULTS)) return res.status(404).json({ message: "Unknown setting" });
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid body" });

  await prisma.setting.upsert({
    where: { key },
    update: { value: parsed.data.value as Prisma.InputJsonValue },
    create: { key, value: parsed.data.value as Prisma.InputJsonValue },
  });
  await recomputeAllReadiness();
  await recordAudit(req.admin?.email ?? "unknown", "setting.updated", "Setting", key, { value: parsed.data.value });
  res.json({ ok: true });
});
