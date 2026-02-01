/*
  Warnings:

  - You are about to drop the column `language` on the `Ad` table. All the data in the column will be lost.
  - You are about to drop the column `metaAdSetId` on the `Campaign` table. All the data in the column will be lost.
  - You are about to drop the column `metaConversionsCampaignId` on the `Partner` table. All the data in the column will be lost.
  - You are about to drop the column `metaLandingPageCampaignId` on the `Partner` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[metaCampaignId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[imageAdSetId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[videoAdSetId]` on the table `Campaign` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AdSetType" AS ENUM ('IMAGE', 'VIDEO');

-- DropIndex
DROP INDEX "Campaign_metaAdSetId_key";

-- AlterTable
ALTER TABLE "Ad" DROP COLUMN "language",
ADD COLUMN     "adSetType" "AdSetType" NOT NULL DEFAULT 'IMAGE';

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "metaAdSetId",
ADD COLUMN     "imageAdSetId" TEXT,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'es',
ADD COLUMN     "metaCampaignId" TEXT,
ADD COLUMN     "videoAdSetId" TEXT;

-- AlterTable
ALTER TABLE "Partner" DROP COLUMN "metaConversionsCampaignId",
DROP COLUMN "metaLandingPageCampaignId";

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_metaCampaignId_key" ON "Campaign"("metaCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_imageAdSetId_key" ON "Campaign"("imageAdSetId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_videoAdSetId_key" ON "Campaign"("videoAdSetId");
