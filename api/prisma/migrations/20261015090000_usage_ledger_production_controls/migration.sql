CREATE TYPE "UsageCostStatus" AS ENUM ('PROVIDER_REPORTED', 'ESTIMATE', 'UNKNOWN');

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Campaign_key_key" ON "Campaign"("key");

CREATE TABLE "ProviderPrice" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputMicros" INTEGER,
  "outputMicros" INTEGER,
  "unitMicros" INTEGER,
  "unitType" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderPrice_provider_model_key" ON "ProviderPrice"("provider", "model");

CREATE TABLE "UsageLedger" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "model" TEXT,
  "inputUnits" INTEGER,
  "outputUnits" INTEGER,
  "totalUnits" INTEGER,
  "unitType" TEXT,
  "costMicros" INTEGER,
  "costCurrency" TEXT NOT NULL DEFAULT 'USD',
  "costStatus" "UsageCostStatus" NOT NULL,
  "executionId" TEXT,
  "campaignId" TEXT,
  "videoJobId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UsageLedger_idempotencyKey_key" ON "UsageLedger"("idempotencyKey");
CREATE INDEX "UsageLedger_provider_occurredAt_idx" ON "UsageLedger"("provider", "occurredAt");
CREATE INDEX "UsageLedger_campaignId_occurredAt_idx" ON "UsageLedger"("campaignId", "occurredAt");
CREATE INDEX "UsageLedger_executionId_idx" ON "UsageLedger"("executionId");

ALTER TABLE "VideoProject" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "AutomationExecution" ADD COLUMN "campaignId" TEXT;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dummy" CHECK ("key" <> '');
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UsageLedger" ADD CONSTRAINT "UsageLedger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
