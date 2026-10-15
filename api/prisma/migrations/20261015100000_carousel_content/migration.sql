CREATE TYPE "CarouselJobState" AS ENUM ('QUEUED', 'GENERATING', 'RENDERING', 'VALIDATING', 'READY', 'FAILED', 'CANCELLED');
CREATE TYPE "CarouselPublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

CREATE TABLE "CarouselProject" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "topic" TEXT NOT NULL, "prompt" TEXT NOT NULL,
  "audience" TEXT, "language" TEXT NOT NULL DEFAULT 'en', "tone" TEXT NOT NULL DEFAULT 'Professional',
  "brand" TEXT NOT NULL DEFAULT 'Eki', "cta" TEXT, "slideCount" INTEGER NOT NULL DEFAULT 6,
  "publishTargets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "campaignId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CarouselProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarouselJob" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "state" "CarouselJobState" NOT NULL DEFAULT 'QUEUED',
  "error" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselJob_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarouselSlide" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "index" INTEGER NOT NULL, "headline" TEXT NOT NULL,
  "body" TEXT NOT NULL, "imageKey" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselSlide_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarouselAsset" (
  "id" TEXT NOT NULL, "jobId" TEXT NOT NULL, "type" TEXT NOT NULL, "index" INTEGER,
  "url" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarouselApproval" (
  "id" TEXT NOT NULL, "carouselJobId" TEXT NOT NULL, "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "channel" TEXT NOT NULL DEFAULT 'TELEGRAM', "note" TEXT, "rejectionReason" TEXT,
  "decidedBy" TEXT, "decidedAt" TIMESTAMP(3), "contentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarouselApproval_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CarouselPublication" (
  "id" TEXT NOT NULL, "carouselJobId" TEXT NOT NULL, "target" TEXT NOT NULL,
  "status" "CarouselPublicationStatus" NOT NULL DEFAULT 'PENDING', "externalId" TEXT,
  "externalUrl" TEXT, "error" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMP(3),
  CONSTRAINT "CarouselPublication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarouselSlide_jobId_index_key" ON "CarouselSlide"("jobId", "index");
CREATE UNIQUE INDEX "CarouselApproval_carouselJobId_key" ON "CarouselApproval"("carouselJobId");
CREATE UNIQUE INDEX "CarouselPublication_carouselJobId_target_key" ON "CarouselPublication"("carouselJobId", "target");
ALTER TABLE "CarouselProject" ADD CONSTRAINT "CarouselProject_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarouselJob" ADD CONSTRAINT "CarouselJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CarouselProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarouselSlide" ADD CONSTRAINT "CarouselSlide_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarouselAsset" ADD CONSTRAINT "CarouselAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarouselApproval" ADD CONSTRAINT "CarouselApproval_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarouselPublication" ADD CONSTRAINT "CarouselPublication_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
