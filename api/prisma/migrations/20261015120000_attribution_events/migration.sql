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
  CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttributionEvent_eventId_key" UNIQUE ("eventId"),
  CONSTRAINT "AttributionEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AttributionEvent_eventType_occurredAt_idx" ON "AttributionEvent"("eventType", "occurredAt");
CREATE INDEX "AttributionEvent_vendorId_occurredAt_idx" ON "AttributionEvent"("vendorId", "occurredAt");
CREATE INDEX "AttributionEvent_campaignId_idx" ON "AttributionEvent"("campaignId");
