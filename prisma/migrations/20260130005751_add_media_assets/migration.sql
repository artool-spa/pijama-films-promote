-- CreateEnum
CREATE TYPE "MetaEntityStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'ERROR');

-- CreateEnum
CREATE TYPE "BudgetType" AS ENUM ('DAILY', 'LIFETIME');

-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('CONVERSIONS', 'LANDING_PAGE_VIEW');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metaConversionsCampaignId" TEXT,
    "metaLandingPageCampaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "metaAdSetId" TEXT,
    "name" TEXT NOT NULL,
    "status" "MetaEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "objective" "CampaignObjective" NOT NULL,
    "budget" DOUBLE PRECISION NOT NULL,
    "budgetType" "BudgetType" NOT NULL DEFAULT 'LIFETIME',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "targetCountries" TEXT[] DEFAULT ARRAY['US']::TEXT[],
    "targetAgeMin" INTEGER NOT NULL DEFAULT 18,
    "targetAgeMax" INTEGER NOT NULL DEFAULT 65,
    "targetGenders" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "includeBaseAudiences" BOOLEAN NOT NULL DEFAULT true,
    "filmGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeLgbtAudience" BOOLEAN NOT NULL DEFAULT false,
    "pixelId" TEXT,
    "conversionEvent" TEXT NOT NULL DEFAULT 'PURCHASE',
    "optimizationGoal" TEXT NOT NULL DEFAULT 'OFFSITE_CONVERSIONS',
    "billingEvent" TEXT NOT NULL DEFAULT 'IMPRESSIONS',
    "bidStrategy" TEXT NOT NULL DEFAULT 'LOWEST_COST_WITHOUT_CAP',
    "filmMuviUuid" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "metaAdId" TEXT,
    "name" TEXT NOT NULL,
    "status" "MetaEntityStatus" NOT NULL DEFAULT 'DRAFT',
    "headlines" TEXT[],
    "bodies" TEXT[],
    "descriptions" TEXT[],
    "callToAction" TEXT NOT NULL DEFAULT 'WATCH_MORE',
    "linkUrl" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "filmMuviUuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "filmMuviUuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "duration" INTEGER,
    "thumbnailUrl" TEXT,
    "metaVideoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedCopy" (
    "id" TEXT NOT NULL,
    "filmId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "primaryText" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "callToAction" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AdImages" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AdImages_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AdVideos" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AdVideos_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partner_partnerId_key" ON "Partner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_metaAdSetId_key" ON "Campaign"("metaAdSetId");

-- CreateIndex
CREATE INDEX "Campaign_partnerId_idx" ON "Campaign"("partnerId");

-- CreateIndex
CREATE INDEX "Campaign_filmMuviUuid_idx" ON "Campaign"("filmMuviUuid");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_metaAdId_key" ON "Ad"("metaAdId");

-- CreateIndex
CREATE INDEX "Ad_campaignId_idx" ON "Ad"("campaignId");

-- CreateIndex
CREATE INDEX "Ad_status_idx" ON "Ad"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Image_storageKey_key" ON "Image"("storageKey");

-- CreateIndex
CREATE INDEX "Image_filmMuviUuid_idx" ON "Image"("filmMuviUuid");

-- CreateIndex
CREATE UNIQUE INDEX "Video_storageKey_key" ON "Video"("storageKey");

-- CreateIndex
CREATE INDEX "Video_filmMuviUuid_idx" ON "Video"("filmMuviUuid");

-- CreateIndex
CREATE INDEX "GeneratedCopy_filmId_idx" ON "GeneratedCopy"("filmId");

-- CreateIndex
CREATE INDEX "GeneratedCopy_language_idx" ON "GeneratedCopy"("language");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedCopy_filmId_language_variant_key" ON "GeneratedCopy"("filmId", "language", "variant");

-- CreateIndex
CREATE INDEX "_AdImages_B_index" ON "_AdImages"("B");

-- CreateIndex
CREATE INDEX "_AdVideos_B_index" ON "_AdVideos"("B");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdImages" ADD CONSTRAINT "_AdImages_A_fkey" FOREIGN KEY ("A") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdImages" ADD CONSTRAINT "_AdImages_B_fkey" FOREIGN KEY ("B") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdVideos" ADD CONSTRAINT "_AdVideos_A_fkey" FOREIGN KEY ("A") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AdVideos" ADD CONSTRAINT "_AdVideos_B_fkey" FOREIGN KEY ("B") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
