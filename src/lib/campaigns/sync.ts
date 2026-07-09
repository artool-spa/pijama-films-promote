import { updateCampaign, markCampaignSynced, markCampaignError, markGoogleCampaignSynced, markGoogleCampaignError } from '@/models/campaign';
import { markAdSynced, markAdError, markGoogleAdSynced } from '@/models/ad';
import { setMetaVideoId } from '@/models/video';
import { publish } from '@/lib/events';
import { createLogger } from '@/lib/logger';

const log = createLogger('campaigns');
import {
  meta,
  createCBOCampaignWithAdSets,
  createDynamicCreativeAd,
  uploadAdVideo,
  buildTargeting,
  MetaApiError,
} from '#meta';
import {
  google,
  createYouTubeCampaignWithAdGroup,
  createVideoAd,
  createDemandGenCampaignWithAdGroup,
  uploadImageAsset,
  createDemandGenImageAd,
  updateCampaignStatus,
  updateAdGroupStatus,
  buildGoogleTargeting,
  GoogleAdsApiError,
} from '#google';
import { calculateAspectRatio, getEligibleYouTubeFormats, isValidGoogleMarketingImage } from '@/lib/assets/validation';
import {
  classifyPlacementBucket,
  FEED_ONLY_PLACEMENTS,
  STORY_ONLY_PLACEMENTS,
  type AssetDimensions,
  type PlacementTargeting,
} from '@/lib/meta/placements';
import { toFriendlyCampaignError } from '@/lib/campaigns/error-messages';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';
import type { Ad } from '@/models/ad';
import { appendUtmParams } from './utm';

// Helper to publish campaign progress
async function emitProgress(filmId: string, campaignId: string, step: string, progress: number, message: string) {
  await publish(filmId, {
    type: 'campaign_progress',
    campaignId,
    step,
    progress,
    message,
  });
}

// ============================================================================
// META SYNC
// ============================================================================

export interface MetaSyncResult {
  synced: boolean;
  pendingAssets?: boolean;
  metaCampaignId?: string;
  imageAdSetId?: string;
  videoAdSetId?: string;
  syncedAds: Ad[];
  adErrors: Array<{ adId: string; error: string }>;
  videoUploadErrors: string[];
  issues?: {
    videoUploads?: { count: number; videoIds: string[]; message: string };
    imageAd?: { error: string; message: string };
    videoAd?: { error: string; message: string };
    summary?: string;
  };
  syncError?: string;
  syncErrorDetails?: unknown;
}

/**
 * Check if all videos in the campaign's ads have metaVideoId
 */
export function areMetaAssetsReady(ads: Ad[]): boolean {
  for (const ad of ads) {
    for (const video of ad.videos) {
      if (!video.metaVideoId) return false;
    }
  }
  return true;
}

/**
 * Check if all videos in the campaign's ads have youtubeVideoId
 */
export function areGoogleAssetsReady(ads: Ad[]): boolean {
  for (const ad of ads) {
    for (const video of ad.videos) {
      if (!video.youtubeVideoId) return false;
    }
  }
  return true;
}

/**
 * Check if ads have at least one image (images are ready immediately, no upload needed)
 */
export function areGoogleImageAssetsReady(ads: Ad[]): boolean {
  return ads.some(ad => ad.images.length > 0);
}

/**
 * Sync a campaign to Meta Ads (create CBO campaign, ad sets, and ads).
 * Assumes ads are already created locally.
 */
/**
 * Decide manual placement targeting for an ad set based on its assets' aspect ratios.
 * - both feed + story assets → undefined (keep automatic placements; the ad's
 *   asset_customization_rules route each asset to the right placement)
 * - feed only (no vertical asset uploaded) → exclude Story/Reels so horizontals never render there
 * - story only → restrict to Story/Reels
 */
function computePlacementOverride(assets: AssetDimensions[]): PlacementTargeting | undefined {
  const hasFeed = assets.some((a) => classifyPlacementBucket(a) === 'feed');
  const hasStory = assets.some((a) => classifyPlacementBucket(a) === 'story');
  if (hasFeed && hasStory) return undefined;
  if (hasStory) return STORY_ONLY_PLACEMENTS;
  if (hasFeed) return FEED_ONLY_PLACEMENTS;
  return undefined;
}

export async function syncCampaignToMeta(
  campaign: CampaignWithPartnerAndAds,
  partnerName: string,
): Promise<MetaSyncResult> {
  const ads = campaign.ads;
  const filmId = campaign.filmMuviUuid;

  // Validate Meta configuration
  if (!meta.pageId) {
    return {
      synced: false,
      syncedAds: [],
      adErrors: [],
      videoUploadErrors: [],
      syncError: 'Meta advertising is not configured on this server yet. Your campaign was saved as a draft — please contact support.',
    };
  }

  await emitProgress(filmId, campaign.id, 'media', 30, 'Processing media assets...');

  // Collect all media with aspect-ratio metadata (used for per-placement asset customization)
  const allImages: Array<{ url: string } & AssetDimensions> = [];
  const allVideos: Array<{ video_id: string } & AssetDimensions> = [];
  const videoUploadErrors: string[] = [];

  for (const ad of ads) {
    for (const image of ad.images) {
      if (!allImages.some((i) => i.url === image.url)) {
        allImages.push({
          url: image.url,
          aspectRatio: image.aspectRatio,
          width: image.width,
          height: image.height,
        });
      }
    }

    for (const video of ad.videos) {
      try {
        let videoId: string;
        if (video.metaVideoId) {
          videoId = video.metaVideoId;
        } else {
          const uploaded = await uploadAdVideo(meta, video.url, video.name);
          videoId = uploaded.video_id;
          await setMetaVideoId(video.id, videoId);
        }
        if (!allVideos.some((v) => v.video_id === videoId)) {
          allVideos.push({
            video_id: videoId,
            aspectRatio: video.aspectRatio,
            width: video.width,
            height: video.height,
          });
        }
      } catch (err) {
        log.error({ err, videoId: video.id }, 'Failed to upload video');
        videoUploadErrors.push(video.id);
      }
    }
  }

  const effectiveHasImages = allImages.length > 0;
  const effectiveHasVideos = allVideos.length > 0;

  if (!effectiveHasImages && !effectiveHasVideos) {
    return {
      synced: false,
      syncedAds: [],
      adErrors: [],
      videoUploadErrors,
      syncError: 'None of the selected images or videos could be processed. Please re-upload your media and try again.',
    };
  }

  await emitProgress(filmId, campaign.id, 'meta_campaign', 40, 'Creating Meta campaign...');

  // Create CBO Campaign with AdSets
  let metaCampaignId: string;
  let imageAdSetId: string | undefined;
  let videoAdSetId: string | undefined;

  try {
    const targeting = await buildTargeting(meta, {
      countries: campaign.targetCountries,
      ageMin: campaign.targetAgeMin,
      ageMax: campaign.targetAgeMax,
      genders: campaign.targetGenders,
      audiences: {
        includeBaseAudiences: campaign.includeBaseAudiences,
        filmGenres: campaign.filmGenres,
        includeLgbtAudience: campaign.includeLgbtAudience,
      },
    });

    const metaObjective = campaign.objective === 'CONVERSIONS'
      ? 'OUTCOME_SALES'
      : 'OUTCOME_TRAFFIC';

    const optimizationGoal = campaign.objective === 'CONVERSIONS'
      ? 'OFFSITE_CONVERSIONS'
      : 'LANDING_PAGE_VIEWS';

    const metaCampaignName = `camp_${partnerName}_${campaign.name}`;
    const promotedObject = campaign.objective === 'CONVERSIONS' && meta.pixelId
      ? { pixel_id: meta.pixelId, custom_event_type: 'PURCHASE' as const }
      : { page_id: meta.pageId! };
    log.info({ promotedObject, objective: campaign.objective, pageId: meta.pageId }, 'Creating CBO campaign with promoted object');
    const cboResult = await createCBOCampaignWithAdSets(meta, {
      name: metaCampaignName,
      objective: metaObjective,
      budget: Math.round(campaign.budget * 100),
      budgetType: campaign.budgetType.toLowerCase() as 'daily' | 'lifetime',
      startTime: campaign.startDate.toISOString(),
      endTime: campaign.endDate?.toISOString(),
      targeting,
      promotedObject,
      hasImages: effectiveHasImages,
      hasVideos: effectiveHasVideos,
      optimizationGoal,
      dsaBeneficiary: partnerName,
      dsaPayor: partnerName,
      // Exclude Story/Reels for ad sets whose assets have no Stories-suitable aspect ratio.
      imagePlacements: effectiveHasImages ? computePlacementOverride(allImages) : undefined,
      videoPlacements: effectiveHasVideos ? computePlacementOverride(allVideos) : undefined,
    });

    metaCampaignId = cboResult.campaignId;
    imageAdSetId = cboResult.imageAdSetId;
    videoAdSetId = cboResult.videoAdSetId;

    await emitProgress(filmId, campaign.id, 'meta_adsets', 60, 'Campaign and ad sets created in Meta');
    await markCampaignSynced(campaign.id, metaCampaignId, imageAdSetId, videoAdSetId);
  } catch (error) {
    log.error({ err: error }, 'Error syncing campaign to Meta');
    await markCampaignError(campaign.id).catch(() => {});

    const syncError = toFriendlyCampaignError(error, 'Meta');
    let syncErrorDetails: unknown = undefined;
    if (error instanceof MetaApiError) {
      syncErrorDetails = {
        code: error.errorCode,
        subcode: error.errorSubcode,
        response: error.response,
      };
    }

    return {
      synced: false,
      syncedAds: [],
      adErrors: [],
      videoUploadErrors,
      syncError,
      syncErrorDetails,
    };
  }

  // Create dynamic creative ads
  const syncedAds: Ad[] = [];
  const adErrors: Array<{ adId: string; error: string }> = [];

  const allHeadlines: string[] = [];
  const allBodies: string[] = [];
  const allDescriptions: string[] = [];
  const linkUrl = appendUtmParams(ads[0]?.linkUrl || '', {
    source: 'meta',
    medium: 'cpc',
    campaign: campaign.name,
    content: campaign.language,
  });
  const callToAction = ads[0]?.callToAction || 'LEARN_MORE';

  for (const ad of ads) {
    allHeadlines.push(...ad.headlines);
    allBodies.push(...ad.bodies);
    if (ad.descriptions) {
      allDescriptions.push(...ad.descriptions);
    }
  }

  const uniqueHeadlines = [...new Set(allHeadlines)].slice(0, 5);
  const uniqueBodies = [...new Set(allBodies)].slice(0, 5);
  const uniqueDescriptions = [...new Set(allDescriptions)].slice(0, 5);

  let imageAdId: string | undefined;
  let videoAdId: string | undefined;
  let imageAdError: string | undefined;
  let videoAdError: string | undefined;

  // Create image ad
  if (effectiveHasImages && imageAdSetId) {
    try {
      await emitProgress(filmId, campaign.id, 'image_ad', 70, 'Creating image ad...');
      const imageAd = await createDynamicCreativeAd(meta, {
        name: `${campaign.name} - Images`,
        adsetId: imageAdSetId,
        pageId: meta.pageId!,
        linkUrl,
        headlines: uniqueHeadlines,
        bodies: uniqueBodies,
        descriptions: uniqueDescriptions.length > 0 ? uniqueDescriptions : undefined,
        callToAction,
        images: allImages,
      });

      if (imageAd.ad_id) {
        imageAdId = imageAd.ad_id;
      }
    } catch (error) {
      imageAdError = toFriendlyCampaignError(error, 'Meta');
      log.error({ err: error }, 'Image ad creation failed');
    }
  }

  // Create video ad
  if (effectiveHasVideos && videoAdSetId) {
    try {
      await emitProgress(filmId, campaign.id, 'video_ad', 85, 'Creating video ad...');
      const videoAd = await createDynamicCreativeAd(meta, {
        name: `${campaign.name} - Videos`,
        adsetId: videoAdSetId,
        pageId: meta.pageId!,
        linkUrl,
        headlines: uniqueHeadlines,
        bodies: uniqueBodies,
        descriptions: uniqueDescriptions.length > 0 ? uniqueDescriptions : undefined,
        callToAction,
        videos: allVideos,
      });

      if (videoAd.ad_id) {
        videoAdId = videoAd.ad_id;
      }
    } catch (error) {
      videoAdError = toFriendlyCampaignError(error, 'Meta');
      log.error({ err: error }, 'Video ad creation failed');
    }
  }

  const hasCreatedAds = imageAdId || videoAdId;

  if (!hasCreatedAds) {
    const errorMessage = imageAdError || videoAdError || 'Failed to create any ads in Meta';
    await publish(filmId, {
      type: 'campaign_error',
      campaignId: campaign.id,
      error: errorMessage,
    });

    for (const ad of ads) {
      await markAdError(ad.id).catch(() => {});
      adErrors.push({ adId: ad.id, error: errorMessage });
    }
  } else {
    await emitProgress(filmId, campaign.id, 'syncing', 95, 'Syncing ad data...');

    for (const ad of ads) {
      if (ad.adSetType === 'VIDEO') {
        if (videoAdId) {
          await markAdSynced(ad.id, videoAdId);
          syncedAds.push({ ...ad, metaAdId: videoAdId });
        } else {
          await markAdError(ad.id).catch(() => {});
          adErrors.push({ adId: ad.id, error: videoAdError || 'Video ad creation failed' });
        }
      } else {
        if (imageAdId) {
          await markAdSynced(ad.id, imageAdId);
          syncedAds.push({ ...ad, metaAdId: imageAdId });
        } else {
          await markAdError(ad.id).catch(() => {});
          adErrors.push({ adId: ad.id, error: imageAdError || 'Image ad creation failed' });
        }
      }
    }

    await emitProgress(filmId, campaign.id, 'complete', 100, 'Campaign created successfully!');
  }

  // Build issues
  const issues: MetaSyncResult['issues'] = {};

  if (videoUploadErrors.length > 0) {
    issues.videoUploads = {
      count: videoUploadErrors.length,
      videoIds: videoUploadErrors,
      message: `${videoUploadErrors.length} video(s) could not be uploaded and were skipped`,
    };
  }
  if (imageAdError) {
    issues.imageAd = {
      error: imageAdError,
      message: `Image ad could not be created: ${imageAdError}`,
    };
  }
  if (videoAdError) {
    issues.videoAd = {
      error: videoAdError,
      message: `Video ad could not be created: ${videoAdError}`,
    };
  }
  if (hasCreatedAds && (imageAdError || videoAdError)) {
    const successCount = (imageAdId ? 1 : 0) + (videoAdId ? 1 : 0);
    const totalCount = (effectiveHasImages ? 1 : 0) + (effectiveHasVideos ? 1 : 0);
    issues.summary = `Campaign created partially. ${successCount} of ${totalCount} ad(s) created.`;
  }

  return {
    synced: syncedAds.length > 0,
    metaCampaignId,
    imageAdSetId,
    videoAdSetId,
    syncedAds,
    adErrors,
    videoUploadErrors,
    issues: Object.keys(issues).length > 0 ? issues : undefined,
  };
}

// ============================================================================
// GOOGLE SYNC
// ============================================================================

export interface GoogleSyncResult {
  synced: boolean;
  pendingAssets?: boolean;
  googleCampaignId?: string;
  googleAdGroupId?: string;
  syncedAds: Ad[];
  adErrors: Array<{ adId: string; error: string }>;
  syncError?: string;
  syncErrorDetails?: unknown;
}

/**
 * Sync a campaign to Google Ads (create YouTube campaign, ad group, and video ads).
 * Assumes ads are already created locally and all videos have youtubeVideoId.
 */
export async function syncCampaignToGoogle(
  campaign: CampaignWithPartnerAndAds,
  partnerName: string,
  options?: {
    googleBidStrategy?: string;
    targetCpvMicros?: bigint;
  },
): Promise<GoogleSyncResult> {
  const ads = campaign.ads;
  const filmId = campaign.filmMuviUuid;

  await emitProgress(filmId, campaign.id, 'google_campaign', 40, 'Creating campaign in Google Ads...');

  let googleCampaignId: string;
  let googleAdGroupId: string;

  try {
    const targeting = await buildGoogleTargeting(google, {
      countries: campaign.targetCountries,
      ageMin: campaign.targetAgeMin,
      ageMax: campaign.targetAgeMax,
      genders: campaign.targetGenders,
      filmGenres: campaign.filmGenres,
      includeBaseAudiences: campaign.includeBaseAudiences,
    });

    const campaignName = `camp_${partnerName}_${campaign.name}_${Date.now()}`;
    const googleResult = await createDemandGenCampaignWithAdGroup(google, {
      name: campaignName,
      budget: campaign.budget,
      budgetType: campaign.budgetType === 'DAILY' ? 'DAILY' : 'TOTAL',
      startDate: campaign.startDate.toISOString().split('T')[0],
      endDate: campaign.endDate?.toISOString().split('T')[0],
      biddingStrategy: options?.googleBidStrategy || 'MAXIMIZE_CLICKS',
      targeting,
    });

    googleCampaignId = googleResult.campaignResourceName;
    googleAdGroupId = googleResult.adGroupResourceName;

    await emitProgress(filmId, campaign.id, 'google_adgroup', 60, 'Campaign and ad group created in Google');
    await markGoogleCampaignSynced(campaign.id, googleCampaignId, googleAdGroupId);
  } catch (error) {
    log.error({ err: error }, 'Error syncing campaign to Google Ads');
    await markGoogleCampaignError(campaign.id).catch(() => {});

    const syncError = toFriendlyCampaignError(error, 'Google');
    let syncErrorDetails: unknown = undefined;
    if (error instanceof GoogleAdsApiError) {
      syncErrorDetails = {
        code: error.errorCode,
        response: error.response,
      };
    }

    return {
      synced: false,
      syncedAds: [],
      adErrors: [],
      syncError,
      syncErrorDetails,
    };
  }

  // Helper to rollback Google campaign on subsequent failures
  const rollbackGoogleCampaign = async () => {
    try {
      await updateCampaignStatus(google, googleCampaignId, 'REMOVED');
      log.info({ googleCampaignId }, 'Rolled back orphaned Google campaign');
    } catch (cleanupErr) {
      log.error({ err: cleanupErr, googleCampaignId }, 'Failed to rollback orphaned Google campaign');
    }
  };

  // Upload Pijama Films logo as Google Ads asset (reused across all ads)
  // Use localhost to avoid DNS issues in Docker — the logo is served by this Next.js instance
  const logoUrl = `http://localhost:${process.env.PORT || 3000}/logo_pijama_square.png`;
  let logoAssetResourceName: string;
  try {
    const logoAsset = await uploadImageAsset(google, logoUrl, 'Pijama Films Logo');
    logoAssetResourceName = logoAsset.resourceName;
  } catch (error) {
    log.error({ err: error }, 'Failed to upload Pijama Films logo');
    await rollbackGoogleCampaign();
    return {
      synced: false,
      syncedAds: [],
      adErrors: [],
      syncError: toFriendlyCampaignError(error, 'Google'),
      syncErrorDetails: error instanceof GoogleAdsApiError ? { code: error.errorCode, response: error.response } : undefined,
    };
  }

  // Create image ads (Demand Gen)
  const syncedAds: Ad[] = [];
  const adErrors: Array<{ adId: string; error: string }> = [];

  for (const ad of ads) {
    if (ad.images.length === 0) {
      adErrors.push({ adId: ad.id, error: 'No images found for this ad' });
      continue;
    }

    // Filter images to only those valid for Google Demand Gen (correct aspect ratio + under 5MB)
    const validImages = ad.images.filter(image => {
      const valid = isValidGoogleMarketingImage(image);
      if (!valid) {
        log.warn({ imageName: image.name, aspectRatio: image.aspectRatio, sizeMB: (image.size / 1024 / 1024).toFixed(1) }, 'Excluding image from Google ad');
      }
      return valid;
    });

    if (validImages.length === 0) {
      adErrors.push({ adId: ad.id, error: 'No images with a valid format for Google Ads. Google requires 1.91:1, 1:1, or 4:5 aspect ratios, max 5MB.' });
      continue;
    }

    try {
      // Upload valid images as Google Ads assets
      await emitProgress(filmId, campaign.id, 'image_upload', 70, `Uploading images: ${ad.name}...`);

      const landscapeImageAssetResourceNames: string[] = [];
      const squareImageAssetResourceNames: string[] = [];
      const portraitImageAssetResourceNames: string[] = [];

      for (const image of validImages) {
        const asset = await uploadImageAsset(google, image.url, `${ad.name} - ${image.name}`);
        const ratio = image.aspectRatio
          ?? (image.width && image.height ? calculateAspectRatio(image.width, image.height) : null);

        switch (ratio) {
          case '1.91:1':
            landscapeImageAssetResourceNames.push(asset.resourceName);
            break;
          case '1:1':
            squareImageAssetResourceNames.push(asset.resourceName);
            break;
          case '4:5':
            portraitImageAssetResourceNames.push(asset.resourceName);
            break;
          default:
            log.warn({ ratio, imageName: image.name }, 'Unexpected aspect ratio after validation');
            break;
        }
      }

      // Create Demand Gen image ad
      await emitProgress(filmId, campaign.id, 'image_ad', 80, `Creating ad: ${ad.name}...`);

      const googleAd = await createDemandGenImageAd(google, {
        name: ad.name,
        adGroupResourceName: googleAdGroupId,
        landscapeImageAssetResourceNames,
        squareImageAssetResourceNames,
        portraitImageAssetResourceNames,
        logoImageAssetResourceNames: [logoAssetResourceName],
        headlines: ad.headlines.map(h => h.substring(0, 30)).slice(0, 5),
        descriptions: ad.bodies.map(b => b.substring(0, 90)).slice(0, 5),
        finalUrl: appendUtmParams(ad.linkUrl, {
          source: 'google',
          medium: 'cpc',
          campaign: campaign.name,
          content: campaign.language,
        }),
        businessName: partnerName.substring(0, 25),
      });

      await markGoogleAdSynced(ad.id, googleAd.resourceName);
      syncedAds.push({ ...ad, googleAdId: googleAd.resourceName });
    } catch (error) {
      const errorMsg = error instanceof GoogleAdsApiError ? error.message : 'Error creating Demand Gen ad';
      log.error(
        { err: error, adId: ad.id, response: error instanceof GoogleAdsApiError ? error.response : undefined },
        'Failed to create Google ad'
      );
      adErrors.push({ adId: ad.id, error: errorMsg });
      // Only mark ad as error if Meta hasn't already synced it successfully
      if (!ad.metaAdId) {
        await markAdError(ad.id).catch(() => {});
      }
    }
  }

  // Enable campaign and ad group after successful ad creation
  if (syncedAds.length > 0) {
    try {
      await emitProgress(filmId, campaign.id, 'enabling', 90, 'Activating campaign in Google Ads...');

      await updateCampaignStatus(google, googleCampaignId, 'ENABLED');
      await updateAdGroupStatus(google, googleAdGroupId, 'ENABLED');

      await updateCampaign(campaign.id, { googleEntityStatus: 'ENABLED' });

      log.info({ googleCampaignId }, 'Campaign and ad group enabled');
    } catch (error) {
      log.error({ err: error }, 'Failed to enable Google campaign');
      adErrors.push({ adId: 'campaign', error: 'Campaign created but could not be enabled' });
    }

    await emitProgress(filmId, campaign.id, 'complete', 100, 'Google Ads campaign created successfully!');
  }

  return {
    synced: syncedAds.length > 0,
    googleCampaignId,
    googleAdGroupId,
    syncedAds,
    adErrors,
  };
}
