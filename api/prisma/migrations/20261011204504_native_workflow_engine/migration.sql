-- CreateEnum
CREATE TYPE "EngineWorkflowCategory" AS ENUM ('SYSTEM', 'CONTENT', 'LEAD_AUTOMATION', 'WHATSAPP', 'SOCIAL', 'AI', 'REPORTING');

-- CreateEnum
CREATE TYPE "EngineTriggerType" AS ENUM ('WEBHOOK', 'EVENT', 'CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "EngineVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EngineExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EngineStepStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EngineOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'WELCOMED', 'CONTACTED', 'CONVERTED', 'DEAD');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('MATCHED', 'DUPLICATE', 'UNMATCHED', 'REWARDED');

-- CreateEnum
CREATE TYPE "FeedbackRequestStatus" AS ENUM ('SENT', 'RESPONDED', 'SKIPPED');

-- CreateTable
CREATE TABLE "EngineWorkflow" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "EngineWorkflowCategory" NOT NULL,
    "triggerType" "EngineTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineWorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "EngineVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "EngineWorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineExecution" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "EngineExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerType" "EngineTriggerType" NOT NULL,
    "triggerPayload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "cursorStepKey" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "deadLetter" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "requestedBy" TEXT,
    "replayOfId" TEXT,

    CONSTRAINT "EngineExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineStepExecution" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "EngineStepStatus" NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "EngineStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineOutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "EngineOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "EngineOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineScheduledTrigger" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunOk" BOOLEAN,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineScheduledTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineLead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "source" TEXT,
    "market" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true,
    "welcomedAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineWaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "wantsEmail" BOOLEAN NOT NULL DEFAULT true,
    "wantsWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "waSentAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineWaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineReferralCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ownerName" TEXT,
    "ownerEmail" TEXT NOT NULL,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineReferral" (
    "id" TEXT NOT NULL,
    "codeId" TEXT,
    "referralCode" TEXT NOT NULL,
    "refereeEmail" TEXT NOT NULL,
    "refereeName" TEXT,
    "status" "ReferralStatus" NOT NULL,
    "rewardSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineFeedbackRequest" (
    "id" TEXT NOT NULL,
    "leadPhone" TEXT NOT NULL,
    "email" TEXT,
    "status" "FeedbackRequestStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "comment" TEXT,

    CONSTRAINT "EngineFeedbackRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineWeeklyReportRun" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "recipients" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineWeeklyReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineWorkflow_key_key" ON "EngineWorkflow"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EngineWorkflow_currentVersionId_key" ON "EngineWorkflow"("currentVersionId");

-- CreateIndex
CREATE INDEX "EngineWorkflow_triggerType_enabled_idx" ON "EngineWorkflow"("triggerType", "enabled");

-- CreateIndex
CREATE INDEX "EngineWorkflowVersion_workflowId_status_idx" ON "EngineWorkflowVersion"("workflowId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EngineWorkflowVersion_workflowId_version_key" ON "EngineWorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EngineExecution_idempotencyKey_key" ON "EngineExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EngineExecution_workflowId_status_idx" ON "EngineExecution"("workflowId", "status");

-- CreateIndex
CREATE INDEX "EngineExecution_status_startedAt_idx" ON "EngineExecution"("status", "startedAt");

-- CreateIndex
CREATE INDEX "EngineExecution_deadLetter_status_idx" ON "EngineExecution"("deadLetter", "status");

-- CreateIndex
CREATE INDEX "EngineExecution_nextRetryAt_idx" ON "EngineExecution"("nextRetryAt");

-- CreateIndex
CREATE INDEX "EngineStepExecution_executionId_stepIndex_idx" ON "EngineStepExecution"("executionId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "EngineStepExecution_executionId_stepKey_attempt_key" ON "EngineStepExecution"("executionId", "stepKey", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineOutboxEvent_dedupeKey_key" ON "EngineOutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "EngineOutboxEvent_status_createdAt_idx" ON "EngineOutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineScheduledTrigger_workflowId_key" ON "EngineScheduledTrigger"("workflowId");

-- CreateIndex
CREATE INDEX "EngineScheduledTrigger_enabled_nextRunAt_idx" ON "EngineScheduledTrigger"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineLead_phone_key" ON "EngineLead"("phone");

-- CreateIndex
CREATE INDEX "EngineLead_status_createdAt_idx" ON "EngineLead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EngineLead_email_idx" ON "EngineLead"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EngineWaitlistEntry_email_key" ON "EngineWaitlistEntry"("email");

-- CreateIndex
CREATE INDEX "EngineWaitlistEntry_createdAt_idx" ON "EngineWaitlistEntry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineReferralCode_code_key" ON "EngineReferralCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EngineReferralCode_ownerEmail_key" ON "EngineReferralCode"("ownerEmail");

-- CreateIndex
CREATE INDEX "EngineReferral_createdAt_idx" ON "EngineReferral"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineReferral_referralCode_refereeEmail_key" ON "EngineReferral"("referralCode", "refereeEmail");

-- CreateIndex
CREATE INDEX "EngineFeedbackRequest_status_idx" ON "EngineFeedbackRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EngineFeedbackRequest_leadPhone_key" ON "EngineFeedbackRequest"("leadPhone");

-- CreateIndex
CREATE INDEX "EngineWeeklyReportRun_periodStart_idx" ON "EngineWeeklyReportRun"("periodStart");

-- AddForeignKey
ALTER TABLE "EngineWorkflow" ADD CONSTRAINT "EngineWorkflow_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "EngineWorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineWorkflowVersion" ADD CONSTRAINT "EngineWorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EngineWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineExecution" ADD CONSTRAINT "EngineExecution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EngineWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineExecution" ADD CONSTRAINT "EngineExecution_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EngineWorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineStepExecution" ADD CONSTRAINT "EngineStepExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "EngineExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineScheduledTrigger" ADD CONSTRAINT "EngineScheduledTrigger_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "EngineWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngineReferral" ADD CONSTRAINT "EngineReferral_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "EngineReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
