-- AlterTable
ALTER TABLE "WhatsAppContact" ADD COLUMN     "lastNurtureAt" TIMESTAMP(3),
ADD COLUMN     "lastNurtureError" TEXT,
ADD COLUMN     "nurtureDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "optInAt" TIMESTAMP(3);

