-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('CONNECTED', 'ACTION_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "CarouselJobState" AS ENUM ('QUEUED', 'SCRIPT_GENERATING', 'RENDERING', 'QUALITY_CHECK', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppContactStatus" AS ENUM ('NEW', 'AWAITING_ROLE', 'SIGNUP_IN_PROGRESS', 'LISTING_PRODUCT', 'COMPLETE', 'UNSUBSCRIBED');

-- AlterEnum
ALTER TYPE "ExecutionSource" ADD VALUE 'AUTOMATION_ENGINE';

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "connectedAccountId" TEXT;

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "tokenCiphertext" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenAuthTag" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "refreshTokenIv" TEXT,
    "refreshTokenAuthTag" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "extra" JSONB NOT NULL DEFAULT '{}',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "voiceAdjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tone" TEXT,
    "formality" TEXT,
    "sentenceStyle" TEXT,
    "preferredPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bannedWords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ctaStyle" TEXT,
    "exampleSentences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "marketDescription" TEXT,
    "commonPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "painPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyEntry" (
    "id" TEXT NOT NULL,
    "audienceProfileId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "meaning" TEXT,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarouselProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "audience" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'Professional',
    "brand" TEXT NOT NULL DEFAULT 'Eki',
    "cta" TEXT,
    "slideCount" INTEGER NOT NULL DEFAULT 6,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarouselProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarouselJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "state" "CarouselJobState" NOT NULL DEFAULT 'QUEUED',
    "script" JSONB,
    "caption" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CarouselJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarouselSlide" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT,
    "visualDirection" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarouselSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarouselApproval" (
    "id" TEXT NOT NULL,
    "carouselJobId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "telegramChatId" TEXT,
    "telegramMessageId" TEXT,
    "note" TEXT,
    "rejectionReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarouselApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppContact" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "status" "WhatsAppContactStatus" NOT NULL DEFAULT 'NEW',
    "entryKeyword" TEXT,
    "source" TEXT,
    "optIn" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductListing" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "price" TEXT,
    "category" TEXT,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectedAccount_provider_idx" ON "ConnectedAccount"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_provider_externalAccountId_key" ON "ConnectedAccount"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "BrandProfile_isActive_idx" ON "BrandProfile"("isActive");

-- CreateIndex
CREATE INDEX "AudienceProfile_isActive_idx" ON "AudienceProfile"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_audienceProfileId_term_key" ON "VocabularyEntry"("audienceProfileId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "CarouselSlide_jobId_index_key" ON "CarouselSlide"("jobId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "CarouselApproval_carouselJobId_key" ON "CarouselApproval"("carouselJobId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppContact_phone_key" ON "WhatsAppContact"("phone");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_contactId_createdAt_idx" ON "WhatsAppMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Publication_connectedAccountId_idx" ON "Publication"("connectedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_videoJobId_connectedAccountId_key" ON "Publication"("videoJobId", "connectedAccountId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyEntry" ADD CONSTRAINT "VocabularyEntry_audienceProfileId_fkey" FOREIGN KEY ("audienceProfileId") REFERENCES "AudienceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarouselJob" ADD CONSTRAINT "CarouselJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarouselProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarouselSlide" ADD CONSTRAINT "CarouselSlide_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarouselApproval" ADD CONSTRAINT "CarouselApproval_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductListing" ADD CONSTRAINT "ProductListing_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

