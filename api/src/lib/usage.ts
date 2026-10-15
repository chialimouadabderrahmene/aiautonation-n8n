import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type UsageInput = {
  idempotencyKey: string; provider: string; operation: string; model?: string;
  inputUnits?: number; outputUnits?: number; totalUnits?: number; unitType?: string;
  providerCostMicros?: number; campaignId?: string; executionId?: string; videoJobId?: string;
  metadata?: Record<string, unknown>;
};

export function calculateCost(input: UsageInput, price?: { inputMicros?: number | null; outputMicros?: number | null; unitMicros?: number | null }): { costMicros: number | null; status: "PROVIDER_REPORTED" | "ESTIMATE" | "UNKNOWN" } {
  if (typeof input.providerCostMicros === "number" && input.providerCostMicros >= 0) return { costMicros: Math.round(input.providerCostMicros), status: "PROVIDER_REPORTED" };
  if (price?.inputMicros != null && price?.outputMicros != null && input.inputUnits != null && input.outputUnits != null) {
    return { costMicros: Math.round(input.inputUnits * price.inputMicros + input.outputUnits * price.outputMicros), status: "ESTIMATE" };
  }
  if (price?.unitMicros != null && input.totalUnits != null) return { costMicros: Math.round(input.totalUnits * price.unitMicros), status: "ESTIMATE" };
  return { costMicros: null, status: "UNKNOWN" };
}

export async function recordUsage(input: UsageInput) {
  const price = input.model ? await prisma.providerPrice.findUnique({ where: { provider_model: { provider: input.provider, model: input.model } } }) : null;
  const cost = calculateCost(input, price ?? undefined);
  return prisma.usageLedger.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      idempotencyKey: input.idempotencyKey, provider: input.provider, operation: input.operation, model: input.model,
      inputUnits: input.inputUnits, outputUnits: input.outputUnits, totalUnits: input.totalUnits, unitType: input.unitType,
      costMicros: cost.costMicros, costCurrency: price?.currency ?? "USD", costStatus: cost.status,
      campaignId: input.campaignId, executionId: input.executionId, videoJobId: input.videoJobId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
