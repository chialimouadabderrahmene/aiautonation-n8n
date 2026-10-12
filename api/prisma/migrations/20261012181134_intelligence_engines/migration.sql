-- CreateTable
CREATE TABLE "EngineTrendPattern" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'apify',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineTrendPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnginePainPoint" (
    "id" TEXT NOT NULL,
    "pain" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "persona" TEXT,
    "keywords" TEXT[],
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'reddit',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnginePainPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineTrendPattern_type_createdAt_idx" ON "EngineTrendPattern"("type", "createdAt");

-- CreateIndex
CREATE INDEX "EnginePainPoint_category_createdAt_idx" ON "EnginePainPoint"("category", "createdAt");
