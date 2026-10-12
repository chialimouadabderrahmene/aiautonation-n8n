-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('UNKNOWN', 'VENDOR', 'BUYER');

-- AlterTable
ALTER TABLE "EngineLead" ADD COLUMN     "leadType" "LeadType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "sequenceState" JSONB NOT NULL DEFAULT '{}';
