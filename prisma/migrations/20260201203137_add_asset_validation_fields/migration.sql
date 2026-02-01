-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'VALIDATING', 'READY', 'INVALID', 'ERROR');

-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "eligibilityError" TEXT,
ADD COLUMN     "facebookEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagramEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "metaImageHash" TEXT,
ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validationError" TEXT;

-- AlterTable
ALTER TABLE "Video" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "eligibilityError" TEXT,
ADD COLUMN     "facebookEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "instagramEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "validatedAt" TIMESTAMP(3),
ADD COLUMN     "validationError" TEXT,
ADD COLUMN     "width" INTEGER;

-- CreateIndex
CREATE INDEX "Image_status_idx" ON "Image"("status");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");
