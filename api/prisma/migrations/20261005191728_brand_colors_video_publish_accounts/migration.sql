-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "accentColorHex" TEXT,
ADD COLUMN     "primaryColorHex" TEXT,
ADD COLUMN     "secondaryColorHex" TEXT;

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "publishAccountIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

