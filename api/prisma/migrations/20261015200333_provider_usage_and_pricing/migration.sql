-- CreateEnum
CREATE TYPE "UsageCostSource" AS ENUM ('PROVIDER_REPORTED', 'ESTIMATED_FROM_PRICING', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ProviderUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "operation" TEXT NOT NULL,
    "workflowKey" TEXT,
    "executionRef" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "mediaUnits" DECIMAL(14,3),
    "mediaUnitType" TEXT,
    "costAmount" DECIMAL(14,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "costSource" "UsageCostSource" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "errorCode" TEXT,
    "latencyMs" INTEGER,

    CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPrice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderUsage_idempotencyKey_key" ON "ProviderUsage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderUsage_createdAt_idx" ON "ProviderUsage"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsage_provider_createdAt_idx" ON "ProviderUsage"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsage_workflowKey_createdAt_idx" ON "ProviderUsage"("workflowKey", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsage_executionRef_idx" ON "ProviderUsage"("executionRef");

-- CreateIndex
CREATE INDEX "ProviderPrice_provider_unit_effectiveFrom_idx" ON "ProviderPrice"("provider", "unit", "effectiveFrom");
