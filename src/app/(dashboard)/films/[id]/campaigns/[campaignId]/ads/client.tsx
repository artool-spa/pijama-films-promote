'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Facebook as FacebookIcon,
  Google as GoogleIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import GoogleDisplayAdPreview from '@/components/GoogleDisplayAdPreview';
import YouTubeAdPreview from '@/components/YouTubeAdPreview';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

type PlatformFilter = 'ALL' | 'META' | 'GOOGLE';

type AdInsights = {
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
};

type AdsDetailClientProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
};

export default function AdsDetailClient({ film, campaign }: AdsDetailClientProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<PlatformFilter>('ALL');
  const [adInsights, setAdInsights] = useState<Record<string, AdInsights>>({});
  const [metaPreviews, setMetaPreviews] = useState<Record<string, string>>({});
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set());

  const platforms = (campaign as Record<string, unknown>).platforms as string[] || [];
  const hasMeta = platforms.includes('META');
  const hasGoogle = platforms.includes('GOOGLE');

  const filteredAds = campaign.ads.filter((ad) => {
    if (filter === 'ALL') return true;
    if (filter === 'META') return !!ad.metaAdId;
    if (filter === 'GOOGLE') return !!ad.googleAdId;
    return true;
  });

  const getAdPlatform = (ad: typeof campaign.ads[0]): 'META' | 'GOOGLE' | null => {
    if (ad.metaAdId) return 'META';
    if (ad.googleAdId) return 'GOOGLE';
    return null;
  };

  // Fetch insights for all ads
  const fetchInsights = useCallback(async () => {
    setLoadingInsights(true);
    const results: Record<string, AdInsights> = {};

    const fetches = campaign.ads.map(async (ad) => {
      try {
        if (ad.metaAdId) {
          const res = await fetch(`/api/meta/ads/${ad.id}/insights`);
          const data = await res.json();
          if (data.synced && data.data) {
            results[ad.id] = data.data;
          }
        } else if (ad.googleAdId) {
          const res = await fetch(`/api/google/ads/${ad.id}/insights`);
          const data = await res.json();
          if (data.synced && data.data) {
            results[ad.id] = data.data;
          }
        }
      } catch {
        // Skip failed fetches
      }
    });

    await Promise.all(fetches);
    setAdInsights(results);
    setLoadingInsights(false);
  }, [campaign.ads]);

  // Fetch Meta ad preview HTML
  const fetchMetaPreview = useCallback(async (adId: string) => {
    setLoadingPreviews((prev) => new Set(prev).add(adId));
    try {
      const res = await fetch(`/api/meta/ads/${adId}/preview?format=MOBILE_FEED_STANDARD`);
      const data = await res.json();
      if (data.preview) {
        setMetaPreviews((prev) => ({ ...prev, [adId]: data.preview }));
      }
    } catch {
      // Skip failed previews
    } finally {
      setLoadingPreviews((prev) => {
        const next = new Set(prev);
        next.delete(adId);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  // Fetch Meta previews for synced ads
  useEffect(() => {
    campaign.ads.forEach((ad) => {
      if (ad.metaAdId && !metaPreviews[ad.id]) {
        fetchMetaPreview(ad.id);
      }
    });
  }, [campaign.ads, fetchMetaPreview, metaPreviews]);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push(`/films/${film.id}/campaigns/${campaign.id}`)}
          sx={{ mb: 2 }}
        >
          Volver a campaña
        </Button>
        <Typography variant="h4" component="h1" gutterBottom>
          Anuncios - {campaign.name}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {film.title} - {campaign.ads.length} anuncios
        </Typography>
      </Box>

      {/* Platform Filter */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <ToggleButtonGroup
          value={filter}
          exclusive
          onChange={(_, value) => value && setFilter(value)}
          size="small"
        >
          <ToggleButton value="ALL">Todos</ToggleButton>
          {hasMeta && (
            <ToggleButton value="META">
              <FacebookIcon sx={{ mr: 0.5, fontSize: 18 }} /> Meta
            </ToggleButton>
          )}
          {hasGoogle && (
            <ToggleButton value="GOOGLE">
              <GoogleIcon sx={{ mr: 0.5, fontSize: 18 }} /> Google
            </ToggleButton>
          )}
        </ToggleButtonGroup>

        {loadingInsights && <CircularProgress size={20} />}
      </Box>

      {/* Ad Cards Grid */}
      {filteredAds.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No hay anuncios para mostrar
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {filteredAds.map((ad) => {
            const platform = getAdPlatform(ad);
            const insights = adInsights[ad.id];
            const metaPreviewHtml = metaPreviews[ad.id];
            const isLoadingPreview = loadingPreviews.has(ad.id);

            return (
              <Grid key={ad.id} size={{ xs: 12, md: 6, lg: 4 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent>
                    {/* Ad Header */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {platform === 'META' && (
                          <Chip
                            icon={<FacebookIcon />}
                            label="Meta"
                            size="small"
                            sx={{ bgcolor: '#1877F2', color: 'white', '& .MuiChip-icon': { color: 'white' } }}
                          />
                        )}
                        {platform === 'GOOGLE' && (
                          <Chip
                            icon={<GoogleIcon />}
                            label="Google"
                            size="small"
                            sx={{ bgcolor: '#4285F4', color: 'white', '& .MuiChip-icon': { color: 'white' } }}
                          />
                        )}
                        {!platform && (
                          <Chip label="Sin sincronizar" size="small" variant="outlined" />
                        )}
                      </Box>
                      <Chip
                        label={ad.status}
                        size="small"
                        color={ad.status === 'ACTIVE' ? 'success' : ad.status === 'ERROR' ? 'error' : 'default'}
                      />
                    </Box>

                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom noWrap>
                      {ad.name}
                    </Typography>

                    {/* Ad Preview */}
                    <Box sx={{ mb: 2 }}>
                      {/* Meta Ad Preview - HTML from API */}
                      {platform === 'META' && (
                        <>
                          {isLoadingPreview && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                              <CircularProgress size={32} />
                            </Box>
                          )}
                          {metaPreviewHtml && (
                            <Box
                              sx={{
                                width: '100%',
                                borderRadius: 1,
                                overflow: 'hidden',
                                border: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <iframe
                                srcDoc={metaPreviewHtml}
                                title={`Preview - ${ad.name}`}
                                style={{
                                  width: '100%',
                                  height: 400,
                                  border: 'none',
                                }}
                                sandbox="allow-scripts allow-same-origin"
                              />
                            </Box>
                          )}
                          {!isLoadingPreview && !metaPreviewHtml && (
                            <Box sx={{ py: 3, textAlign: 'center', bgcolor: 'grey.50', borderRadius: 1 }}>
                              <Typography variant="body2" color="text.secondary">
                                Vista previa no disponible
                              </Typography>
                            </Box>
                          )}
                        </>
                      )}

                      {/* Google Display Ad Preview - Native component */}
                      {platform === 'GOOGLE' && ad.adSetType === 'IMAGE' && (
                        <GoogleDisplayAdPreview
                          headline={ad.headlines[0]}
                          description={ad.descriptions[0] || ad.bodies[0]}
                          imageUrl={ad.images[0]?.url}
                          callToAction={ad.callToAction}
                          businessName={campaign.partner.name}
                        />
                      )}

                      {/* Google Video Ad Preview - Native component */}
                      {platform === 'GOOGLE' && ad.adSetType === 'VIDEO' && ad.youtubeAdFormat && (
                        <YouTubeAdPreview
                          adFormat={ad.youtubeAdFormat}
                          headline={ad.headlines[0]}
                          description={ad.descriptions[0] || ad.bodies[0]}
                          thumbnailUrl={ad.videos[0]?.thumbnailUrl ?? undefined}
                          callToAction={ad.callToAction}
                          channelName={campaign.partner.name}
                        />
                      )}

                      {/* Unsynced ad fallback */}
                      {!platform && ad.images.length > 0 && (
                        <Box
                          sx={{
                            width: '100%',
                            aspectRatio: '1.91/1',
                            borderRadius: 1,
                            overflow: 'hidden',
                            bgcolor: 'grey.100',
                          }}
                        >
                          <Box
                            component="img"
                            src={ad.images[0].url}
                            alt={ad.name}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </Box>
                      )}
                    </Box>

                    {/* Per-Ad Metrics */}
                    {insights && (
                      <>
                        <Divider sx={{ mb: 1.5 }} />
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                          Métricas
                        </Typography>
                        <Grid container spacing={1}>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Impresiones
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {insights.impressions.toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Clicks
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {insights.clicks.toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              CTR
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {insights.ctr.toFixed(2)}%
                            </Typography>
                          </Grid>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Gasto
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">
                              ${insights.spend.toFixed(2)}
                            </Typography>
                          </Grid>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Conversiones
                            </Typography>
                            <Typography variant="body2" fontWeight="medium" color="success.main">
                              {insights.conversions.toLocaleString()}
                            </Typography>
                          </Grid>
                          <Grid size={4}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              Costo/Conv.
                            </Typography>
                            <Typography variant="body2" fontWeight="medium">
                              {insights.costPerConversion > 0
                                ? `$${insights.costPerConversion.toFixed(2)}`
                                : '-'}
                            </Typography>
                          </Grid>
                        </Grid>
                      </>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Container>
  );
}
