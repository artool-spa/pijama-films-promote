'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  Grid,
  Typography,
} from '@mui/material';
import { Image as ImageIcon } from '@mui/icons-material';
import AdEditForm, { type AdEditFormValues } from '@/components/AdEditForm';
import AdMediaPicker, { type PickerAsset } from '@/components/AdMediaPicker';
import GoogleDisplayAdPreview from '@/components/GoogleDisplayAdPreview';
import YouTubeAdPreview from '@/components/YouTubeAdPreview';
import { MAX_AD_ASSETS } from '@/lib/assets/limits';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';
import type { ImageWithUsage } from '@/models/image';
import type { VideoWithUsage } from '@/models/video';

/** Google Demand Gen caps headlines at 40 chars; Meta allows 255. */
const GOOGLE_HEADLINE_MAX_LENGTH = 40;
/** Matches the campaign wizard. Every request hits Meta's Graph API. */
const PREVIEW_DEBOUNCE_MS = 500;

type CampaignAd = CampaignWithPartnerAndAds['ads'][number];

export type AdContentEditorProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
  ad: CampaignAd;
  images: ImageWithUsage[];
  videos: VideoWithUsage[];
  saving: boolean;
  onSubmit: (values: AdEditFormValues, mediaIds: string[]) => Promise<void>;
};

/** Media the preview can render, whatever list it came from. */
type PreviewMedia = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  metaVideoId: string | null;
};

function isHttpUrl(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\//i.test(value);
}

/**
 * Meta returns the preview as an HTML-escaped `<iframe src="...">` snippet.
 * Pull the URL out and render our own frame instead of injecting third-party
 * markup into the page: this keeps a real cross-origin boundary around it.
 */
export function metaPreviewSrc(html: string): string | null {
  const match = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(html);
  if (!match) return null;

  const decoded = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

  try {
    const url = new URL(decoded);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default function AdContentEditor({
  film,
  campaign,
  ad,
  images,
  videos,
  saving,
  onSubmit,
}: AdContentEditorProps) {
  const isVideoAd = ad.adSetType === 'VIDEO';
  const adPlatform: 'META' | 'GOOGLE' | null = ad.metaAdId
    ? 'META'
    : ad.googleAdId
      ? 'GOOGLE'
      : null;
  const isGoogleAd = !!ad.googleAdId;
  // An unsynced ad still gets a preview: /api/meta/preview creates nothing.
  const previewPlatform: 'META' | 'GOOGLE' =
    adPlatform ?? (campaign.platforms.includes('META') ? 'META' : 'GOOGLE');
  const needsMetaVideo = adPlatform === 'META' || campaign.platforms.includes('META');
  // resyncAdCreativeToGoogle only handles Demand Gen image ads.
  const mediaReadOnly = isGoogleAd && isVideoAd;

  const [mediaIds, setMediaIds] = useState<string[]>(() =>
    isVideoAd ? ad.videos.map((video) => video.id) : ad.images.map((image) => image.id)
  );
  const [live, setLive] = useState<AdEditFormValues>({
    headlines: ad.headlines,
    bodies: ad.bodies,
    descriptions: ad.descriptions,
  });
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const assets = useMemo<PickerAsset[]>(() => {
    const library: PickerAsset[] = isVideoAd
      ? videos.map((video) => ({
          id: video.id,
          name: video.name,
          thumbnailUrl: video.thumbnailUrl,
          status: video.status,
          aspectRatio: video.aspectRatio,
          usedInAds: video._count.ads,
          disabledReason:
            video.status === 'INVALID' || video.status === 'ERROR'
              ? video.validationError || 'This video failed validation.'
              : needsMetaVideo && !video.metaVideoId
                ? // sync drops these and Meta then rejects the creative.
                  'Still uploading to Meta. Available in a few minutes.'
                : null,
          warning: null,
        }))
      : images.map((image) => ({
          id: image.id,
          name: image.name,
          thumbnailUrl: image.url,
          status: image.status,
          aspectRatio: image.aspectRatio,
          usedInAds: image._count.ads,
          disabledReason:
            image.status === 'INVALID' || image.status === 'ERROR'
              ? image.validationError || 'This image failed validation.'
              : null,
          warning: isGoogleAd
            ? image.googleEligible
              ? null
              : 'Google Ads may reject this image.'
            : image.facebookEligible || image.instagramEligible
              ? null
              : 'Meta may reject this image.',
        }));

    // The library excludes archived assets, so an attached one can be missing
    // from it. Show it anyway — otherwise saving would silently drop it.
    const known = new Set(library.map((asset) => asset.id));
    const isOrphan = (id: string) => mediaIds.includes(id) && !known.has(id);
    const orphanDefaults = {
      status: 'READY' as const,
      usedInAds: 1,
      disabledReason: 'No longer in your asset library.',
      warning: 'Archived or removed.',
    };
    const orphans: PickerAsset[] = isVideoAd
      ? ad.videos
          .filter((video) => isOrphan(video.id))
          .map((video) => ({
            id: video.id,
            name: video.name,
            thumbnailUrl: video.thumbnailUrl,
            // The ad's hydrated videos carry no aspect ratio.
            aspectRatio: null,
            ...orphanDefaults,
          }))
      : ad.images
          .filter((image) => isOrphan(image.id))
          .map((image) => ({
            id: image.id,
            name: image.name,
            thumbnailUrl: image.url,
            aspectRatio: image.aspectRatio,
            ...orphanDefaults,
          }));

    return [...library, ...orphans];
  }, [ad.images, ad.videos, images, videos, isVideoAd, isGoogleAd, needsMetaVideo, mediaIds]);

  const mediaError = mediaIds.length === 0 ? 'Select at least one asset.' : null;

  /** Everything the preview can draw, keyed by id. */
  const previewMedia = useMemo<Map<string, PreviewMedia>>(() => {
    const entries = new Map<string, PreviewMedia>();
    for (const image of images) {
      entries.set(image.id, { id: image.id, url: image.url, thumbnailUrl: null, metaVideoId: null });
    }
    for (const video of videos) {
      entries.set(video.id, {
        id: video.id,
        url: video.url,
        thumbnailUrl: video.thumbnailUrl,
        metaVideoId: video.metaVideoId,
      });
    }
    for (const image of ad.images) {
      if (!entries.has(image.id)) {
        entries.set(image.id, { id: image.id, url: image.url, thumbnailUrl: null, metaVideoId: null });
      }
    }
    for (const video of ad.videos) {
      if (!entries.has(video.id)) {
        entries.set(video.id, {
          id: video.id,
          url: video.url,
          thumbnailUrl: video.thumbnailUrl,
          metaVideoId: video.metaVideoId,
        });
      }
    }
    return entries;
  }, [images, videos, ad.images, ad.videos]);

  // Meta rotates every asset; previewing the first one is representative.
  const previewAsset = mediaIds.length > 0 ? previewMedia.get(mediaIds[0]) ?? null : null;
  const headline = live.headlines.find((value) => value.trim())?.trim();
  const primaryText = live.bodies.find((value) => value.trim())?.trim();
  const description = live.descriptions.find((value) => value.trim())?.trim();
  const videoNotReady = previewPlatform === 'META' && isVideoAd && !previewAsset?.metaVideoId;

  /** Non-null only when a request is worth making. */
  const previewRequest = useMemo(() => {
    if (previewPlatform !== 'META' || !previewAsset) return null;
    if (!headline || !primaryText) return null;
    // The preview API requires a real URL, and rejects a video with no Meta id.
    if (!isHttpUrl(ad.linkUrl)) return null;
    if (isVideoAd && !previewAsset.metaVideoId) return null;

    const mediaUrl = isVideoAd ? previewAsset.thumbnailUrl ?? previewAsset.url : previewAsset.url;
    if (!isHttpUrl(mediaUrl)) return null;

    return {
      headline,
      primaryText,
      description: description || undefined,
      // Still sent even though the field left the form: it is what the ad
      // actually points to.
      linkUrl: ad.linkUrl,
      mediaUrl,
      mediaType: ad.adSetType,
      metaVideoId: isVideoAd ? previewAsset.metaVideoId ?? undefined : undefined,
      thumbnailUrl: isVideoAd ? previewAsset.thumbnailUrl ?? undefined : undefined,
      format: 'MOBILE_FEED_STANDARD' as const,
    };
  }, [
    previewPlatform,
    previewAsset,
    headline,
    primaryText,
    description,
    ad.linkUrl,
    ad.adSetType,
    isVideoAd,
  ]);

  const runPreview = useCallback(async () => {
    if (!previewRequest) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const res = await fetch('/api/meta/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(previewRequest),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPreviewError(
          data.code === 'VIDEO_NOT_READY'
            ? 'This video is still being processed by Meta. The preview will appear once it finishes.'
            : data.details || data.error || 'Could not generate the preview.'
        );
        setPreviewHtml(null);
        return;
      }

      const data = (await res.json()) as { preview?: string };
      setPreviewHtml(data.preview ?? null);
    } catch (err) {
      // A superseded request must not clear the newer one's state.
      if (err instanceof Error && err.name === 'AbortError') return;
      setPreviewError('Could not generate the preview.');
      setPreviewHtml(null);
    } finally {
      if (!controller.signal.aborted) {
        setPreviewLoading(false);
      }
    }
  }, [previewRequest]);

  useEffect(() => {
    if (!previewRequest) {
      abortRef.current?.abort();
      setPreviewHtml(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      void runPreview();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [previewRequest, runPreview]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const previewSrc = previewHtml ? metaPreviewSrc(previewHtml) : null;

  const emptyPreview = (message: string) => (
    <Box
      sx={{
        border: '1px dashed',
        borderColor: 'divider',
        borderRadius: 1,
        p: 4,
        textAlign: 'center',
        color: 'text.secondary',
      }}
    >
      <ImageIcon sx={{ fontSize: 32, color: 'grey.400' }} />
      <Typography variant="body2" sx={{ mt: 1 }}>
        {message}
      </Typography>
    </Box>
  );

  const renderPreview = () => {
    if (previewPlatform === 'GOOGLE') {
      if (isVideoAd) {
        return ad.youtubeAdFormat ? (
          <YouTubeAdPreview
            adFormat={ad.youtubeAdFormat}
            headline={headline}
            description={description || primaryText}
            thumbnailUrl={previewAsset?.thumbnailUrl ?? undefined}
            callToAction={ad.callToAction}
            channelName={campaign.partner.name}
          />
        ) : (
          emptyPreview('Preview not available for this ad format.')
        );
      }
      return (
        <GoogleDisplayAdPreview
          headline={headline}
          description={description || primaryText}
          imageUrl={previewAsset?.url}
          callToAction={ad.callToAction}
          businessName={campaign.partner.name}
        />
      );
    }

    if (mediaIds.length === 0) {
      return emptyPreview('Select at least one asset to see how the ad will look.');
    }
    if (!headline || !primaryText) {
      return emptyPreview('Add a headline and primary text to see the preview.');
    }
    if (videoNotReady) {
      return (
        <Alert severity="info">
          This video is still uploading to Meta. The preview will appear once processing finishes.
        </Alert>
      );
    }
    if (previewError) {
      return (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => void runPreview()}>
              Retry
            </Button>
          }
        >
          {previewError}
        </Alert>
      );
    }
    if (previewSrc) {
      return (
        <Box sx={{ position: 'relative' }}>
          <Box
            component="iframe"
            src={previewSrc}
            title="Meta ad preview"
            referrerPolicy="no-referrer"
            // Cross-origin frame, so Facebook's own scripts keep their origin.
            sandbox="allow-scripts"
            sx={{ width: '100%', height: 660, border: 'none' }}
          />
          {previewLoading && (
            // Keep the old render visible: blanking on every keystroke is worse
            // than a slightly stale preview.
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                bgcolor: 'rgba(255,255,255,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CircularProgress size={28} />
            </Box>
          )}
        </Box>
      );
    }
    if (previewLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      );
    }
    if (previewHtml) {
      return <Alert severity="warning">Could not display the preview returned by Meta.</Alert>;
    }
    return emptyPreview('The preview will appear here.');
  };

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}>
        {ad.approvalStatus === 'DISAPPROVED' && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>This ad was rejected</AlertTitle>
            {ad.rejectionReason}
            {ad.suggestedCorrection && (
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                {ad.suggestedCorrection.split(' • ').map((tip, i) => (
                  <li key={i}>{tip}</li>
                ))}
              </Box>
            )}
          </Alert>
        )}

        <Alert severity={adPlatform ? 'warning' : 'info'} sx={{ mb: 3 }}>
          {adPlatform
            ? `Saving replaces the creative on ${
                adPlatform === 'META' ? 'Meta' : 'Google Ads'
              }. The platform will publish a new ad, pause the current one, and the ad will re-enter review before it starts delivering again.`
            : 'This ad has not been published to any platform yet. Changes are saved locally only.'}
        </Alert>

        {mediaReadOnly && (
          <Alert severity="info" sx={{ mb: 3 }}>
            Media cannot be changed for YouTube ads yet. You can still edit the text.
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <AdMediaPicker
            label={isVideoAd ? 'Videos' : 'Images'}
            assets={assets}
            selectedIds={mediaIds}
            onChange={setMediaIds}
            max={MAX_AD_ASSETS}
            readOnly={mediaReadOnly}
            error={mediaError ?? undefined}
            emptyMessage={
              isVideoAd
                ? 'This film has no videos yet.'
                : 'This film has no images yet.'
            }
            manageHref={`/films/${film.id}/assets`}
          />
        </Box>

        <AdEditForm
          initial={{
            headlines: ad.headlines,
            bodies: ad.bodies,
            descriptions: ad.descriptions,
          }}
          onChange={setLive}
          onSubmit={(values) => onSubmit(values, mediaIds)}
          submitting={saving}
          submitDisabled={!!mediaError}
          submitLabel="Save ad content"
          headlineMaxLength={isGoogleAd ? GOOGLE_HEADLINE_MAX_LENGTH : undefined}
          requireDescription={isGoogleAd}
        />
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Box sx={{ position: { md: 'sticky' }, top: 16 }}>
          <Typography variant="subtitle2" gutterBottom>
            Preview
          </Typography>
          {renderPreview()}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            {previewPlatform === 'META'
              ? 'Preview of the first selected asset in the Facebook mobile feed. Meta rotates all selected assets automatically.'
              : 'Approximate preview. Google does not provide a live render.'}
          </Typography>
        </Box>
      </Grid>
    </Grid>
  );
}
