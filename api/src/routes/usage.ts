import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

/**
 * Provider usage and cost. Every number here comes from ProviderUsage rows written by the
 * provider calls themselves. Cost is shown as "known" (sum of priced calls) and "unknown" (calls
 * with no price or no usage data). Unknown is never added in as zero.
 */
export const usageRouter = Router();

const UNITS = ["input_token", "output_token", "second", "character", "credit", "request"] as const;

const filterSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  provider: z.string().min(1).max(64).optional(),
  workflowKey: z.string().min(1).max(128).optional(),
});

function whereFrom(q: z.infer<typeof filterSchema>) {
  return {
    ...(q.provider ? { provider: q.provider } : {}),
    ...(q.workflowKey ? { workflowKey: q.workflowKey } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
  };
}

usageRouter.get("/summary", async (req, res) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid filter", issues: parsed.error.issues });
  const where = whereFrom(parsed.data);

  const groups = await prisma.providerUsage.groupBy({
    by: ["provider", "currency", "costSource", "status"],
    where,
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true, mediaUnits: true, costAmount: true },
  });

  type Row = { provider: string; calls: number; succeeded: number; failed: number; inputTokens: number; outputTokens: number; mediaUnits: number; knownCost: Record<string, number>; unknownCalls: number; providerReportedCalls: number };
  const byProvider = new Map<string, Row>();
  for (const g of groups) {
    const row = byProvider.get(g.provider) ?? { provider: g.provider, calls: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, mediaUnits: 0, knownCost: {}, unknownCalls: 0, providerReportedCalls: 0 };
    const n = g._count._all;
    row.calls += n;
    if (g.status === "SUCCEEDED") row.succeeded += n;
    else row.failed += n;
    row.inputTokens += g._sum.inputTokens ?? 0;
    row.outputTokens += g._sum.outputTokens ?? 0;
    row.mediaUnits += Number(g._sum.mediaUnits ?? 0);
    if (g.costSource === "UNKNOWN") row.unknownCalls += n;
    else {
      if (g.costSource === "PROVIDER_REPORTED") row.providerReportedCalls += n;
      row.knownCost[g.currency] = (row.knownCost[g.currency] ?? 0) + Number(g._sum.costAmount ?? 0);
    }
    byProvider.set(g.provider, row);
  }
  const providers = [...byProvider.values()].sort((a, b) => b.calls - a.calls);
  const totals = providers.reduce(
    (t, p) => ({ calls: t.calls + p.calls, failed: t.failed + p.failed, unknownCalls: t.unknownCalls + p.unknownCalls }),
    { calls: 0, failed: 0, unknownCalls: 0 },
  );
  res.json({ filter: parsed.data, totals, providers, note: "knownCost sums only calls with a price or a provider-reported cost; unknownCalls are excluded, never counted as zero." });
});

usageRouter.get("/records", async (req, res) => {
  const parsed = filterSchema.extend({ limit: z.coerce.number().int().min(1).max(200).default(50) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid filter", issues: parsed.error.issues });
  const { limit, ...filter } = parsed.data;
  const records = await prisma.providerUsage.findMany({ where: whereFrom(filter), orderBy: { createdAt: "desc" }, take: limit });
  res.json({ records });
});

usageRouter.get("/prices", async (_req, res) => {
  const prices = await prisma.providerPrice.findMany({ orderBy: [{ provider: "asc" }, { unit: "asc" }, { effectiveFrom: "desc" }] });
  res.json({ prices });
});

const priceSchema = z.object({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128).nullable().optional(),
  unit: z.enum(UNITS),
  unitPrice: z.number().finite().nonnegative().max(100_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveFrom: z.string().datetime().optional(),
  note: z.string().max(300).optional(),
});

/** Price writes change every future cost estimate, so every write is audited with the actor. */
usageRouter.post("/prices", async (req: AuthedRequest, res) => {
  const parsed = priceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid price", issues: parsed.error.issues });
  const by = req.admin?.email ?? "unknown";
  const price = await prisma.providerPrice.create({
    data: {
      provider: parsed.data.provider,
      model: parsed.data.model ?? null,
      unit: parsed.data.unit,
      unitPrice: parsed.data.unitPrice,
      currency: parsed.data.currency,
      effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : new Date(),
      note: parsed.data.note ?? null,
      createdBy: by,
    },
  });
  await recordAudit(by, "provider_price.created", "ProviderPrice", price.id, { provider: price.provider, model: price.model, unit: price.unit, unitPrice: parsed.data.unitPrice, currency: price.currency });
  res.status(201).json({ price });
});
