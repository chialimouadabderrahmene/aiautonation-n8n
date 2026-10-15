import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const usageRouter = Router();

usageRouter.get("/", async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.usageLedger.findMany({ where: { occurredAt: { gte: since } }, orderBy: { occurredAt: "desc" } });
  const aggregate = (items: typeof rows) => ({ calls: items.length, providerReportedMicros: items.filter((r) => r.costStatus === "PROVIDER_REPORTED").reduce((n, r) => n + (r.costMicros ?? 0), 0), estimatedMicros: items.filter((r) => r.costStatus === "ESTIMATE").reduce((n, r) => n + (r.costMicros ?? 0), 0), unknownCalls: items.filter((r) => r.costStatus === "UNKNOWN").length });
  const grouped = (key: (r: typeof rows[number]) => string) => rows.reduce<Record<string, typeof rows>>((out, row) => { const k = key(row); (out[k] ??= []).push(row); return out; }, {});
  const byProvider = Object.entries(grouped((r) => r.provider)).map(([provider, items]) => ({ provider, ...aggregate(items) }));
  const byCampaign = Object.entries(grouped((r) => r.campaignId ?? "unattributed")).map(([campaignId, items]) => ({ campaignId, ...aggregate(items) }));
  res.json({ since, currency: "USD", totals: aggregate(rows), byProvider, byCampaign, unknownCostWarning: rows.some((r) => r.costStatus === "UNKNOWN"), rows });
});

const priceSchema = z.object({ provider: z.string().min(1).max(60), model: z.string().min(1).max(120), inputMicros: z.number().int().nonnegative().nullable().optional(), outputMicros: z.number().int().nonnegative().nullable().optional(), unitMicros: z.number().int().nonnegative().nullable().optional(), unitType: z.string().max(40).nullable().optional(), currency: z.string().length(3).default("USD") });
usageRouter.put("/pricing", async (req: AuthedRequest, res) => {
  const parsed = priceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid pricing" });
  const p = parsed.data;
  const price = await prisma.providerPrice.upsert({ where: { provider_model: { provider: p.provider, model: p.model } }, update: p, create: p });
  await recordAudit(req.admin?.email ?? "unknown", "pricing.updated", "ProviderPrice", price.id, { provider: p.provider, model: p.model });
  res.json(price);
});
