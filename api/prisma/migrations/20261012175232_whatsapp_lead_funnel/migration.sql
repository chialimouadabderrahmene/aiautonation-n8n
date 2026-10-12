-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE 'UNSUBSCRIBED';

-- AlterTable
ALTER TABLE "EngineLead" ADD COLUMN     "conversationStep" TEXT,
ADD COLUMN     "highIntent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EngineWhatsAppConversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "replySent" TEXT,
    "conversationStep" TEXT,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineWhatsAppConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineWhatsAppConversation_messageId_key" ON "EngineWhatsAppConversation"("messageId");

-- CreateIndex
CREATE INDEX "EngineWhatsAppConversation_phone_createdAt_idx" ON "EngineWhatsAppConversation"("phone", "createdAt");
