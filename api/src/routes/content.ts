import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { enqueueContentMultiplication } from "../lib/queue";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const contentRouter = Router();

const multiplySchema = z.object({ idea: z.string().trim().min(1).max(500) });

/** Native port of n8n workflow 18's webhook — async here (202), see lib/queue.ts's enqueueContentMultiplication for why. */
contentRouter.post("/multiply", async (req: AuthedRequest, res) => {
  const parsed = multiplySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "idea is required" });
  await enqueueContentMultiplication(parsed.data.idea, req.admin?.email ?? "unknown");
  await recordAudit(req.admin?.email ?? "unknown", "content.multiply_requested", "ContentVariant", "bulk", { idea: parsed.data.idea.slice(0, 100) });
  res.status(202).json({ ok: true, message: "Queued — the worker expands this idea into content variants" });
});

contentRouter.get("/variants", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await prisma.contentVariant.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, take: 200 }));
});

contentRouter.post("/variants/:id/used", async (req: AuthedRequest, res) => {
  const variant = await prisma.contentVariant.update({ where: { id: String(req.params.id) }, data: { status: "used" } });
  await recordAudit(req.admin?.email ?? "unknown", "content.variant_marked_used", "ContentVariant", variant.id);
  res.json(variant);
});
