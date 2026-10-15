import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Identical copy lives in worker/src/lib/usage-ledger.ts — keep byte-for-byte in sync
// (enforced by test/parity.test.ts).
//
// Records what each billable provider call used and what it cost. Two rules are never broken:
//   - unknown cost is stored as NULL with costSource UNKNOWN, never as zero;
//   - a duplicate report of the same call attempt is stored once (idempotencyKey).
// Recording is best-effort: a failure to write a usage row is logged and never fails the business
// call that produced it, so accounting can never block content generation or publishing.

export type UsageUnitType = "seconds" | "characters" | "credits" | "requests";
export type UsageCostSource = "PROVIDER_REPORTED" | "ESTIMATED_FROM_PRICING" | "UNKNOWN";

export interface UsageRecordInput {
  provider: string;
  model?: string | null;
  operation: string;
  workflowKey?: string | null;
  /** EngineExecution id, AutomationExecution id, or pipeline job id. */
  executionRef?: string | null;
  attempt?: number;
  status: "SUCCEEDED" | "FAILED";
  inputTokens?: number | null;
  outputTokens?: number | null;
  mediaUnits?: number | null;
  mediaUnitType?: UsageUnitType | null;
  providerReportedCost?: { amount: number; currency: string } | null;
  /** The provider's own request id when it returns one. Part of the duplicate key. */
  requestId?: string | null;
  errorCode?: string | null;
  latencyMs?: number | null;
}

export interface PriceRow {
  provider: string;
  model: string | null;
  unit: string;
  unitPrice: number;
  currency: string;
  effectiveFrom: Date;
}

const UNIT_FOR_MEDIA: Record<UsageUnitType, string> = { seconds: "second", characters: "character", credits: "credit", requests: "request" };

/** The price that applies at `at`: newest effective row; a model-specific row beats a provider-wide one. */
export function pickPrice(prices: PriceRow[], provider: string, model: string | null | undefined, unit: string, at: Date): PriceRow | null {
  const candidates = prices.filter((p) => p.provider === provider && p.unit === unit && p.effectiveFrom.getTime() <= at.getTime() && (p.model === null || p.model === (model ?? null)));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const specificity = Number(b.model !== null) - Number(a.model !== null);
    return specificity !== 0 ? specificity : b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  });
  return candidates[0] ?? null;
}

export interface CostResult {
  amount: number | null;
  currency: string;
  source: UsageCostSource;
}

/** Pure. Null amount whenever any billable component lacks a price or there is nothing to price. */
export function computeCost(input: UsageRecordInput, prices: PriceRow[], at: Date): CostResult {
  if (input.providerReportedCost && Number.isFinite(input.providerReportedCost.amount)) {
    return { amount: input.providerReportedCost.amount, currency: input.providerReportedCost.currency || "USD", source: "PROVIDER_REPORTED" };
  }
  const components: { unit: string; quantity: number }[] = [];
  if (input.inputTokens != null) components.push({ unit: "input_token", quantity: input.inputTokens });
  if (input.outputTokens != null) components.push({ unit: "output_token", quantity: input.outputTokens });
  if (input.mediaUnits != null && input.mediaUnitType) components.push({ unit: UNIT_FOR_MEDIA[input.mediaUnitType], quantity: input.mediaUnits });
  if (components.length === 0) return { amount: null, currency: "USD", source: "UNKNOWN" };

  let total = 0;
  let currency: string | null = null;
  for (const c of components) {
    const price = pickPrice(prices, input.provider, input.model, c.unit, at);
    if (!price) return { amount: null, currency: currency ?? "USD", source: "UNKNOWN" };
    if (currency !== null && currency !== price.currency) return { amount: null, currency, source: "UNKNOWN" };
    currency = price.currency;
    total += c.quantity * price.unitPrice;
  }
  return { amount: Math.round(total * 1e6) / 1e6, currency: currency ?? "USD", source: "ESTIMATED_FROM_PRICING" };
}

/**
 * Stable key for one call attempt. A duplicate report of the same attempt yields the same key when
 * the provider's request id is known. With no request id there is nothing that proves two reports
 * are the same attempt, so each report gets its own key: a missed dedupe is safer than merging two
 * real calls and under-counting spend.
 */
export function usageIdempotencyKey(input: UsageRecordInput): string {
  const requestId = input.requestId ?? `local-${crypto.randomUUID()}`;
  const parts = [input.provider, input.operation, input.executionRef ?? "-", String(input.attempt ?? 1), requestId];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

export type RecordOutcome = "recorded" | "duplicate" | "failed";

export async function recordUsage(input: UsageRecordInput, at = new Date()): Promise<RecordOutcome> {
  try {
    const prices = await prisma.providerPrice.findMany({ where: { provider: input.provider, effectiveFrom: { lte: at } } });
    const priceRows: PriceRow[] = prices.map((p) => ({ provider: p.provider, model: p.model, unit: p.unit, unitPrice: Number(p.unitPrice), currency: p.currency, effectiveFrom: p.effectiveFrom }));
    const cost = computeCost(input, priceRows, at);
    await prisma.providerUsage.create({
      data: {
        provider: input.provider,
        model: input.model ?? null,
        operation: input.operation,
        workflowKey: input.workflowKey ?? null,
        executionRef: input.executionRef ?? null,
        attempt: input.attempt ?? 1,
        status: input.status,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        mediaUnits: input.mediaUnits == null ? null : new Prisma.Decimal(input.mediaUnits),
        mediaUnitType: input.mediaUnitType ?? null,
        costAmount: cost.amount == null ? null : new Prisma.Decimal(cost.amount),
        currency: cost.currency,
        costSource: cost.source,
        idempotencyKey: usageIdempotencyKey(input),
        errorCode: input.errorCode ?? null,
        latencyMs: input.latencyMs ?? null,
      },
    });
    return "recorded";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
    console.error(JSON.stringify({ level: "error", msg: "[usage] could not record provider usage (business call unaffected)", provider: input.provider, operation: input.operation, err: err instanceof Error ? err.message : String(err) }));
    return "failed";
  }
}
