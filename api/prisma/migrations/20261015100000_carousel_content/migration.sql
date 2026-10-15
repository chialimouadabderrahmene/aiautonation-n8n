-- Idempotent carousel schema reconciliation.
-- Earlier EKI database revisions created carousel tables/types before this
-- repository's migration history was consolidated. This migration must work
-- on both a fresh database and those existing installations.
DO $$ BEGIN
  CREATE TYPE "CarouselJobState" AS ENUM ('QUEUED', 'GENERATING', 'RENDERING', 'VALIDATING', 'READY', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CarouselPublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CarouselProject" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "topic" TEXT NOT NULL, "prompt" TEXT NOT NULL,
  "audience" TEXT, "language" TEXT NOT NULL DEFAULT 'en', "tone" TEXT NOT NULL DEFAULT 'Professional',
  "brand" TEXT NOT NULL DEFAULT 'Eki', "cta" TEXT, "slideCount" INTEGER NOT NULL DEFAULT 6,
  "publishTargets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "campaignId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarouselProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CarouselJob" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "state" "CarouselJobState" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CarouselSlide" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "index" INTEGER NOT NULL, "headline" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '', "imageKey" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselSlide_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CarouselAsset" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "type" TEXT NOT NULL, "index" INTEGER,
  "url" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CarouselApproval" (
  "id" TEXT NOT NULL, "carouselJobId" TEXT NOT NULL, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "channel" TEXT NOT NULL DEFAULT 'TELEGRAM', "note" TEXT, "rejectionReason" TEXT,
  "decidedBy" TEXT, "decidedAt" TIMESTAMP(3), "contentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselApproval_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "CarouselPublication" (
  "id" TEXT NOT NULL, "carouselJobId" TEXT NOT NULL, "target" TEXT NOT NULL,
  "status" "CarouselPublicationStatus" NOT NULL DEFAULT 'PENDING', "externalId" TEXT,
  "externalUrl" TEXT, "error" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMP(3),
  CONSTRAINT "CarouselPublication_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CarouselProject" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "CarouselProject" ADD COLUMN IF NOT EXISTS "publishTargets" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CarouselJob" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "CarouselJob" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CarouselJob" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "CarouselSlide" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "CarouselSlide" ADD COLUMN IF NOT EXISTS "imageKey" TEXT;
ALTER TABLE "CarouselSlide" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'PENDING';
ALTER TABLE "CarouselApproval" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "CarouselPublication" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "CarouselPublication" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "CarouselPublication" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE "CarouselPublication" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CarouselPublication" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

UPDATE "CarouselSlide" SET "body" = '' WHERE "body" IS NULL;
ALTER TABLE "CarouselSlide" ALTER COLUMN "body" SET NOT NULL;
UPDATE "CarouselSlide" SET "status" = 'PENDING' WHERE "status" IS NULL;
ALTER TABLE "CarouselSlide" ALTER COLUMN "status" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CarouselSlide_jobId_index_key" ON "CarouselSlide"("jobId", "index");
CREATE UNIQUE INDEX IF NOT EXISTS "CarouselApproval_carouselJobId_key" ON "CarouselApproval"("carouselJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "CarouselPublication_carouselJobId_target_key" ON "CarouselPublication"("carouselJobId", "target");

DO $$ BEGIN
  ALTER TABLE "CarouselProject" ADD CONSTRAINT "CarouselProject_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CarouselJob" ADD CONSTRAINT "CarouselJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarouselProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CarouselSlide" ADD CONSTRAINT "CarouselSlide_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CarouselAsset" ADD CONSTRAINT "CarouselAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CarouselApproval" ADD CONSTRAINT "CarouselApproval_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CarouselPublication" ADD CONSTRAINT "CarouselPublication_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
