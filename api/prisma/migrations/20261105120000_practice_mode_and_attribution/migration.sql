-- Practice mode: carousels made while practising are simulated and removable.
ALTER TABLE "CarouselProject" ADD COLUMN "testMode" BOOLEAN NOT NULL DEFAULT false;

-- Marketplace signup and activation events.
CREATE TABLE "AttributionEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "leadId" TEXT,
    "vendorId" TEXT,
    "campaignId" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaignName" TEXT,
    "content" TEXT,
    "term" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttributionEvent_eventId_key" ON "AttributionEvent"("eventId");
CREATE INDEX "AttributionEvent_eventType_occurredAt_idx" ON "AttributionEvent"("eventType", "occurredAt");
CREATE INDEX "AttributionEvent_vendorId_occurredAt_idx" ON "AttributionEvent"("vendorId", "occurredAt");
