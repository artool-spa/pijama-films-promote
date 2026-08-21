'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Container,
  Link,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { type AdEditFormValues } from '@/components/AdEditForm';
import AdContentEditor from './AdContentEditor';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';
import type { ImageWithUsage } from '@/models/image';
import type { VideoWithUsage } from '@/models/video';

type CampaignAd = CampaignWithPartnerAndAds['ads'][number];

export type CampaignEditClientProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
  images: ImageWithUsage[];
  videos: VideoWithUsage[];
  focusSection: 'ad' | null;
  focusAdId: string | null;
};

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export default function CampaignEditClient({
  film,
  campaign,
  images,
  videos,
  focusSection,
  focusAdId,
}: CampaignEditClientProps) {
  const router = useRouter();
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [savingAd, setSavingAd] = useState(false);
  const [budget, setBudget] = useState<string>(String(campaign.budget));
  const [endDate, setEndDate] = useState<string>(
    campaign.endDate ? new Date(campaign.endDate).toISOString().slice(0, 10) : ''
  );
  const [selectedAdId, setSelectedAdId] = useState<string | null>(
    campaign.ads.find((a) => a.id === focusAdId)?.id ?? campaign.ads[0]?.id ?? null
  );
  const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' | 'warning' } | null>(null);
  const adSectionRef = useRef<HTMLDivElement | null>(null);
  const backHref = `/films/${film.id}/campaigns/${campaign.id}`;

  const selectedAd: CampaignAd | null =
    campaign.ads.find((a) => a.id === selectedAdId) ?? null;
  const adPlatform: 'META' | 'GOOGLE' | null = selectedAd?.metaAdId
    ? 'META'
    : selectedAd?.googleAdId
      ? 'GOOGLE'
      : null;

  // Deep link from the ads list ("Edit ad" / "Fix and resubmit").
  useEffect(() => {
    if (focusSection !== 'ad') return;
    adSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusSection]);

  const handleCampaignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCampaign(true);
    try {
      const payload: Record<string, unknown> = {};
      const budgetNumber = Number(budget);
      if (!Number.isNaN(budgetNumber) && budgetNumber > 0 && budgetNumber !== campaign.budget) {
        payload.budget = budgetNumber;
      }
      if (endDate) {
        const parsed = new Date(endDate);
        if (!campaign.endDate || parsed.getTime() !== new Date(campaign.endDate).getTime()) {
          payload.endDate = parsed.toISOString();
        }
      }

      if (Object.keys(payload).length === 0) {
        setSnack({ message: 'No changes to save', severity: 'warning' });
        return;
      }

      const res = await fetch(`/api/meta/campaigns/${campaign.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save changes');
      }

      const data = (await res.json()) as { warnings?: string[] };
      if (data.warnings && data.warnings.length > 0) {
        setSnack({
          message: `Saved locally. Platform push had issues: ${data.warnings.join('; ')}`,
          severity: 'warning',
        });
      } else {
        setSnack({ message: 'Campaign updated', severity: 'success' });
      }

      router.refresh();
    } catch (err) {
      setSnack({
        message: err instanceof Error ? err.message : 'Failed to save changes',
        severity: 'error',
      });
    } finally {
      setSavingCampaign(false);
    }
  };

  const handleAdSubmit = async (ad: CampaignAd, values: AdEditFormValues, mediaIds: string[]) => {
    if (mediaIds.length === 0) {
      setSnack({ message: 'Select at least one asset.', severity: 'error' });
      return;
    }

    setSavingAd(true);
    try {
      // Only send what actually changed: the API treats any creative field as a
      // change and rebuilds the ad on the platform, which restarts review.
      const payload: Record<string, unknown> = {};
      if (!sameStrings(values.headlines, ad.headlines)) payload.headlines = values.headlines;
      if (!sameStrings(values.bodies, ad.bodies)) payload.bodies = values.bodies;
      if (!sameStrings(values.descriptions, ad.descriptions)) {
        payload.descriptions = values.descriptions;
      }
      // linkUrl is never sent: it is derived from the film's rental URL.
      if (ad.adSetType === 'IMAGE') {
        const current = ad.images.map((image) => image.id);
        if (!sameStrings(mediaIds, current)) payload.imageIds = mediaIds;
      } else {
        const current = ad.videos.map((video) => video.id);
        if (!sameStrings(mediaIds, current)) payload.videoIds = mediaIds;
      }

      if (Object.keys(payload).length === 0) {
        setSnack({ message: 'No changes to save', severity: 'warning' });
        return;
      }

      const res = await fetch(`/api/meta/ads/${ad.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save changes');
      }

      const data = (await res.json()) as { warnings?: string[] };
      if (data.warnings && data.warnings.length > 0) {
        setSnack({
          message: `Saved locally. Platform push had issues: ${data.warnings.join('; ')}`,
          severity: 'warning',
        });
      } else {
        setSnack({
          message: adPlatform
            ? `Ad content saved. ${adPlatform === 'META' ? 'Meta' : 'Google Ads'} will review the ad again.`
            : 'Ad content saved.',
          severity: 'success',
        });
      }

      router.refresh();
    } catch (err) {
      setSnack({
        message: err instanceof Error ? err.message : 'Failed to save changes',
        severity: 'error',
      });
    } finally {
      setSavingAd(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link underline="hover" color="inherit" href={`/films/${film.id}/campaigns`}>
          {film.title}
        </Link>
        <Link underline="hover" color="inherit" href={backHref}>
          {campaign.name}
        </Link>
        <Typography color="text.primary">Edit</Typography>
      </Breadcrumbs>

      <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(backHref)} sx={{ mb: 1 }}>
        Back to campaign
      </Button>

      <Typography variant="h4" component="h1" gutterBottom>
        Edit campaign
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {campaign.name}
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Budget, end date and ad content can be edited on a live campaign. Start date and targeting
        are locked once the campaign has been submitted to the platforms.
      </Alert>

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" gutterBottom>
            Campaign settings
          </Typography>
          <Box component="form" onSubmit={handleCampaignSubmit} sx={{ mt: 2 }}>
            <Stack spacing={3}>
              <TextField
                label={`Budget (${campaign.budgetType === 'DAILY' ? 'daily' : 'lifetime'}, USD)`}
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputProps={{ min: 0.01, step: 0.01 }}
                required
                helperText={`Currently: $${campaign.budget}`}
              />

              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                helperText={
                  campaign.endDate
                    ? `Currently: ${new Date(campaign.endDate).toISOString().slice(0, 10)}`
                    : 'Currently: no end date'
                }
              />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={() => router.push(backHref)} disabled={savingCampaign}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={savingCampaign}
                >
                  {savingCampaign ? 'Saving...' : 'Save campaign settings'}
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      <Box id="ad-content" ref={adSectionRef} sx={{ scrollMarginTop: 16 }}>
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              Ad content
            </Typography>

            {!selectedAd ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                This campaign has no ads yet.
              </Alert>
            ) : (
              <>
                {campaign.ads.length > 1 ? (
                  <>
                    <Tabs
                      value={selectedAd.id}
                      onChange={(_, value: string) => setSelectedAdId(value)}
                      variant="scrollable"
                      scrollButtons="auto"
                      sx={{ mb: 1 }}
                    >
                      {campaign.ads.map((ad) => (
                        <Tab
                          key={ad.id}
                          value={ad.id}
                          label={ad.name}
                          sx={
                            ad.approvalStatus === 'DISAPPROVED'
                              ? { color: 'error.main' }
                              : undefined
                          }
                        />
                      ))}
                    </Tabs>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                      Switching ads discards unsaved changes.
                    </Typography>
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {selectedAd.name}
                  </Typography>
                )}

                {/*
                  Keying the whole editor resets copy, media and preview
                  together, both when switching ads and after a save bumps
                  `updatedAt` through router.refresh().
                */}
                <AdContentEditor
                  key={`${selectedAd.id}:${new Date(selectedAd.updatedAt).getTime()}`}
                  film={film}
                  campaign={campaign}
                  ad={selectedAd}
                  images={images}
                  videos={videos}
                  saving={savingAd}
                  onSubmit={(values, mediaIds) => handleAdSubmit(selectedAd, values, mediaIds)}
                />
              </>
            )}
          </CardContent>
        </Card>
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Container>
  );
}
