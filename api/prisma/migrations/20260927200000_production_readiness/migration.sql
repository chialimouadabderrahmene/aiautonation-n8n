-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "AutomationExecution" ADD COLUMN     "mode" TEXT;

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "authType" TEXT NOT NULL DEFAULT 'API_KEY',
ADD COLUMN     "connectedAccount" TEXT,
ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "n8nCredentialIds" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VideoAsset" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "VideoJob" ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "musicFileId" TEXT,
ADD COLUMN     "publishTargets" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "VideoScene" ADD COLUMN     "voiceDurationSec" DOUBLE PRECISION,
ADD COLUMN     "voiceKey" TEXT;

-- AlterTable
ALTER TABLE "WorkflowConfig" ADD COLUMN     "lastTestRunAt" TIMESTAMP(3),
ADD COLUMN     "lastTestRunMessage" TEXT,
ADD COLUMN     "lastTestRunOk" BOOLEAN,
ADD COLUMN     "n8nActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "n8nDefinitionHash" TEXT,
ADD COLUMN     "n8nPresent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "n8nSyncedAt" TIMESTAMP(3),
ADD COLUMN     "triggerKind" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "videoJobId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MUSIC',
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "codeVerifierEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHeartbeat" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "instance" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ServiceHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Publication_videoJobId_target_key" ON "Publication"("videoJobId", "target");

-- CreateIndex
CREATE INDEX "ServiceHeartbeat_service_lastSeenAt_idx" ON "ServiceHeartbeat"("service", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_source_externalId_key" ON "AutomationExecution"("source", "externalId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_videoJobId_fkey" FOREIGN KEY ("videoJobId") REFERENCES "VideoJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

