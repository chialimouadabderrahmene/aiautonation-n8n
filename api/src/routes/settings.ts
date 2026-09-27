import { Router } from "express";
import { z } from "zod";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { SETTINGS, getAllSettings, getSettingDefinition, setSetting, validateSetting } from "../modules/settings/schema";

export const settingsRouter = Router();

/** Schema (for rendering) + current values. Settings with `n8nEnv` reach n8n
 * automatically via the supervisor — no environment editing. */
settingsRouter.get("/", async (_req, res) => {
  res.json({ schema: SETTINGS, values: await getAllSettings() });
});

const setSchema = z.object({ value: z.union([z.string(), z.number(), z.boolean()]) });

settingsRouter.put("/:key", async (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const def = getSettingDefinition(key);
  if (!def) return res.status(404).json({ message: "Unknown setting" });
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid body" });
  const value = typeof parsed.data.value === "string" ? parsed.data.value.trim() : parsed.data.value;
  const problem = validateSetting(def, value);
  if (problem) return res.status(400).json({ message: `${def.label}: ${problem}` });

  await setSetting(key, value);
  await recomputeAllReadiness();
  await recordAudit(req.admin?.email ?? "unknown", "setting.updated", "Setting", key, { value });
  res.json({ ok: true, appliesToN8n: Boolean(def.n8nEnv) });
});
