-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "GoogleEntityStatus" AS ENUM ('DRAFT', 'PENDING', 'ENABLED', 'PAUSED', 'REMOVED', 'ERROR');

-- CreateEnum
CREATE TYPE "YouTubeAdFormat" AS ENUM ('IN_STREAM_SKIPPABLE', 'IN_STREAM_NON_SKIPPABLE', 'IN_FEED', 'BUMPER', 'SHORTS');

-- AlterTable: Campaign - Add Google Ads fields
ALTER TABLE "Campaign" ADD COLUMN "platforms" "AdPlatform"[] DEFAULT ARRAY['META']::"AdPlatform"[];
ALTER TABLE "Campaign" ADD COLUMN "googleCampaignId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "googleAdGroupId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "googleEntityStatus" "GoogleEntityStatus";
ALTER TABLE "Campaign" ADD COLUMN "googleBidStrategy" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "targetCpvMicros" BIGINT;

-- AlterTable: Ad - Add Google fields
ALTER TABLE "Ad" ADD COLUMN "googleAdId" TEXT;
ALTER TABLE "Ad" ADD COLUMN "youtubeAdFormat" "YouTubeAdFormat";

-- AlterTable: Video - Add YouTube fields
ALTER TABLE "Video" ADD COLUMN "youtubeEligible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Video" ADD COLUMN "youtubeVideoId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_googleCampaignId_key" ON "Campaign"("googleCampaignId");
CREATE UNIQUE INDEX "Campaign_googleAdGroupId_key" ON "Campaign"("googleAdGroupId");
CREATE INDEX "Campaign_platforms_idx" ON "Campaign"("platforms");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_googleAdId_key" ON "Ad"("googleAdId");
