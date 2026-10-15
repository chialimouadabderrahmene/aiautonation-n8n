-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PublicationStatus" ADD VALUE 'SCHEDULED';
ALTER TYPE "PublicationStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "CarouselPublication" ADD COLUMN     "scheduleTimezone" TEXT,
ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "scheduleTimezone" TEXT,
ADD COLUMN     "scheduleVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CarouselPublication_status_scheduledFor_idx" ON "CarouselPublication"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Publication_status_scheduledFor_idx" ON "Publication"("status", "scheduledFor");
