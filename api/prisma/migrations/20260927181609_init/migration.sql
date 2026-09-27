-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM ('AI', 'ORCHESTRATION', 'MESSAGING', 'EMAIL', 'SOCIAL', 'RESEARCH', 'MEDIA');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED', 'TEST_FAILED', 'CONNECTED', 'ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "WorkflowReadiness" AS ENUM ('READY', 'BLOCKED', 'ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "ExecutionSource" AS ENUM ('N8N', 'VIDEO_WORKER', 'CONTROL_CENTER');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VideoJobState" AS ENUM ('QUEUED', 'SCRIPT_GENERATING', 'STORYBOARD_READY', 'VOICE_GENERATING', 'VISUAL_GENERATING', 'ASSEMBLING', 'QUALITY_CHECK', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VideoAssetType" AS ENUM ('VOICEOVER', 'SCENE', 'SUBTITLES', 'MUSIC', 'FINAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "lastTestLatencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedCredential" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "maskedPreview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncryptedCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requiredProviders" TEXT[],
    "optionalProviders" TEXT[],
    "n8nWorkflowId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "readiness" "WorkflowReadiness" NOT NULL DEFAULT 'BLOCKED',
    "readinessDetail" JSONB NOT NULL DEFAULT '[]',
    "lastExecutionAt" TIMESTAMP(3),
    "lastExecutionOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "source" "ExecutionSource" NOT NULL,
    "workflowConfigId" TEXT,
    "externalId" TEXT,
    "trigger" TEXT,
    "provider" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "audience" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'Professional',
    "durationSec" INTEGER NOT NULL DEFAULT 30,
    "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
    "visualStyle" TEXT NOT NULL DEFAULT 'Realistic',
    "voicePreset" TEXT,
    "music" TEXT NOT NULL DEFAULT 'none',
    "subtitles" BOOLEAN NOT NULL DEFAULT true,
    "brand" TEXT NOT NULL DEFAULT 'Eki',
    "cta" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "state" "VideoJobState" NOT NULL DEFAULT 'QUEUED',
    "script" JSONB,
    "storyboard" JSONB,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "finalVideoUrl" TEXT,
    "error" TEXT,
    "errorStage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "costMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VideoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoScene" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "visualPrompt" TEXT NOT NULL,
    "voiceoverText" TEXT,
    "subtitleText" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 5,
    "provider" TEXT NOT NULL DEFAULT 'runway',
    "providerJobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sceneVideoUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VideoScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAsset" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "VideoAssetType" NOT NULL,
    "provider" TEXT,
    "providerJobId" TEXT,
    "url" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "videoJobId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "telegramChatId" TEXT,
    "telegramMessageId" TEXT,
    "note" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_key" ON "Integration"("provider");

-- CreateIndex
CREATE INDEX "Integration_category_idx" ON "Integration"("category");

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedCredential_integrationId_fieldName_key" ON "EncryptedCredential"("integrationId", "fieldName");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowConfig_key_key" ON "WorkflowConfig"("key");

-- CreateIndex
CREATE INDEX "AutomationExecution_source_status_idx" ON "AutomationExecution"("source", "status");

-- CreateIndex
CREATE INDEX "AutomationExecution_startedAt_idx" ON "AutomationExecution"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoScene_jobId_index_key" ON "VideoScene"("jobId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_videoJobId_key" ON "Approval"("videoJobId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "EncryptedCredential" ADD CONSTRAINT "EncryptedCredential_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_workflowConfigId_fkey" FOREIGN KEY ("workflowConfigId") REFERENCES "WorkflowConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoJob" ADD CONSTRAINT "VideoJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoScene" ADD CONSTRAINT "VideoScene_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
