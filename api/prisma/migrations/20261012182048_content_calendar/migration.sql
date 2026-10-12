-- AlterTable
ALTER TABLE "EngineContentDraft" ADD COLUMN     "dayNumber" INTEGER;

-- CreateTable
CREATE TABLE "EngineContentCalendarEntry" (
    "dayNumber" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "pillar" TEXT,
    "topicBrief" TEXT NOT NULL,
    "suggestedHook" TEXT,
    "cta" TEXT,
    "targetAudience" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineContentCalendarEntry_pkey" PRIMARY KEY ("dayNumber")
);

-- CreateIndex
CREATE INDEX "EngineContentDraft_dayNumber_idx" ON "EngineContentDraft"("dayNumber");
