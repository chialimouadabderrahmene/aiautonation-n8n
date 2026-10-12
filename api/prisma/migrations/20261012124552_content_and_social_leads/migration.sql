-- CreateEnum
CREATE TYPE "ContentDraftStatus" AS ENUM ('DRAFT', 'QUEUED', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "EngineContentDraft" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "platform" TEXT,
    "contentType" TEXT,
    "body" TEXT NOT NULL,
    "hashtags" TEXT[],
    "status" "ContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "EngineContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineSocialLead" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "lastCommentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineSocialLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineContentDraft_source_status_createdAt_idx" ON "EngineContentDraft"("source", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngineSocialLead_channel_externalId_key" ON "EngineSocialLead"("channel", "externalId");
