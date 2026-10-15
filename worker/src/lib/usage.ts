import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type UsageInput = {
  idempotencyKey: string; provider: string; operation: string; model?: string;
  inputUnits?: number; outputUnits?: number; totalUnits?: number; unitType?: string;
  providerCostMicros?: number; campaignId?: string; executionId?: string; videoJobId?: string;
  metadata?: Record<string, unknown>;
};

/** Kept byte-for-byte compatible with api/src/lib/usage.ts: API and worker
 * are separate deployments, but write the same idempotent ledger contract. */
export function calculateCost(input: UsageInput, price?: { inputMicros?: number | null; outputMicros?: number | null; unitMicros?: number | null }) {
  if (typeof input.providerCostMicros === "number" && input.providerCostMicros >= 0) return { costMicros: Math.round(input.providerCostMicros), status: "PROVIDER_REPORTED" as const };
  if (price?.inputMicros != null && price?.outputMicros != null && input.inputUnits != null && input.outputUnits != null) return { costMicros: Math.round(input.inputUnits * price.inputMicros + input.outputUnits * price.outputMicros), status: "ESTIMATE" as const };
  if (price?.unitMicros != null && input.totalUnits != null) return { costMicros: Math.round(input.totalUnits * price.unitMicros), status: "ESTIMATE" as const };
  return { costMicros: null, status: "UNKNOWN" as const };
}

export async function recordUsage(input: UsageInput) {
  const price = input.model ? await prisma.providerPrice.findUnique({ where: { provider_model: { provider: input.provider, model: input.model } } }) : null;
  const cost = calculateCost(input, price ?? undefined);
  return prisma.usageLedger.upsert({
    where: { idempotencyKey: input.idempotencyKey }, update: {},
    create: { idempotencyKey: input.idempotencyKey, provider: input.provider, operation: input.operation, model: input.model,
      inputUnits: input.inputUnits, outputUnits: input.outputUnits, totalUnits: input.totalUnits, unitType: input.unitType,
      costMicros: cost.costMicros, costCurrency: price?.currency ?? "USD", costStatus: cost.status,
      campaignId: input.campaignId, executionId: input.executionId, videoJobId: input.videoJobId, metadata: (input.metadata ?? {}) as Prisma.InputJsonValue },
  });
}
