-- AlterTable
ALTER TABLE "CarouselProject" ADD COLUMN     "publishAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishTargets" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CarouselPublication" (
    "id" TEXT NOT NULL,
    "carouselJobId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "connectedAccountId" TEXT,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "CarouselPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarouselPublication_connectedAccountId_idx" ON "CarouselPublication"("connectedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CarouselPublication_carouselJobId_target_key" ON "CarouselPublication"("carouselJobId", "target");

-- CreateIndex
CREATE UNIQUE INDEX "CarouselPublication_carouselJobId_connectedAccountId_key" ON "CarouselPublication"("carouselJobId", "connectedAccountId");

-- AddForeignKey
ALTER TABLE "CarouselPublication" ADD CONSTRAINT "CarouselPublication_carouselJobId_fkey" FOREIGN KEY ("carouselJobId") REFERENCES "CarouselJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarouselPublication" ADD CONSTRAINT "CarouselPublication_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

