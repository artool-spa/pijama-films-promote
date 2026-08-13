'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Chip,
  CircularProgress,
  Divider,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  YouTube as YouTubeIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  Google as GoogleIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';
import type { ReactNode } from 'react';
import { explainCampaignState } from '@/lib/campaigns/status-explainer';
import { normalizeApprovalSummary, type ApprovalSummary } from '@/lib/campaigns/approval-status';
import CampaignStatusCard from '@/components/CampaignStatusCard';
import ApprovalWarningBanner from '@/components/ApprovalWarningBanner';

type CampaignStatus = 'DRAFT' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR' | 'FINISHED';

type CampaignDetailClientProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
};

type InsightsData = {
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  frequency: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
  cpm: number;
  cpc: number;
  dateStart: string;
  dateEnd: string;
};

type YouTubeInsightsData = {
  impressions: number;
  videoViews: number;
  videoViewRate: number;
  averageCpv: number;
  spend: number;
  clicks: number;
  ctr: number;
  videoQuartile25Rate: number;
  videoQuartile50Rate: number;
  videoQuartile75Rate: number;
  videoQuartile100Rate: number;
  dateStart: string;
  dateEnd: string;
};

type DisplayInsightsData = {
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  spend: number;
  conversions: number;
  cpm: number;
  cpc: number;
  costPerConversion: number;
  dateStart: string;
  dateEnd: string;
};

type PlatformInsights = {
  platform: string;
  platformLabel: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  costPerConversion: number;
  ctr: number;
};

type MetricRowProps = {
  label: string;
  value: string;
};

function MetricRow({ label, value }: MetricRowProps) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight="medium">
        {value}
      </Typography>
    </Box>
  );
}

type PlatformCardProps = {
  icon: ReactNode;
  label: string;
  color: string;
  metrics: { label: string; value: string }[];
};

function PlatformCard({ icon, label, color, metrics }: PlatformCardProps) {
  return (
    <Card variant="outlined" sx={{ borderTop: 3, borderTopColor: color }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          {icon}
          <Typography variant="subtitle1" fontWeight="bold">
            {label}
          </Typography>
        </Box>
        <Divider sx={{ mb: 1.5 }} />
        {metrics.map((m) => (
          <MetricRow key={m.label} label={m.label} value={m.value} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function CampaignDetailClient({ film, campaign }: CampaignDetailClientProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(
    new Date(campaign.startDate).toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    campaign.endDate ? new Date(campaign.endDate).toISOString().split('T')[0] : ''
  );
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [youtubeInsights, setYoutubeInsights] = useState<YouTubeInsightsData | null>(null);
  const [displayInsights, setDisplayInsights] = useState<DisplayInsightsData | null>(null);
  const [platformInsights, setPlatformInsights] = useState<PlatformInsights[] | null>(null);
  const [googleCampaignType, setGoogleCampaignType] = useState<'DEMAND_GEN' | 'VIDEO' | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const platforms = (campaign as Record<string, unknown>).platforms as string[] || [];
  const hasGoogle = platforms.includes('GOOGLE');
  const hasMeta = platforms.includes('META');
  const isSynced = (hasMeta && !!campaign.metaCampaignId) ||
    (hasGoogle && !!(campaign as Record<string, unknown>).googleCampaignId);

  // Fetch insights from the appropriate API(s)
  const fetchInsights = useCallback(async () => {
    if (!isSynced) return;

    setInsightsLoading(true);
    setInsightsError(null);

    try {
      // Constrain the reported metrics to the selected period
      const metaParams = new URLSearchParams({ breakdown: 'platform' });
      if (startDate) metaParams.set('since', startDate);
      if (endDate) metaParams.set('until', endDate);

      // Fetch Meta insights with platform breakdown if Meta platform is present and synced
      if (hasMeta && campaign.metaCampaignId) {
        const metaResponse = await fetch(
          `/api/meta/campaigns/${campaign.id}/insights?${metaParams.toString()}`
        );
        const metaData = await metaResponse.json();
        if (metaData.synced && metaData.data) {
          setInsights(metaData.data);
          if (metaData.platforms && metaData.platforms.length > 0) {
            setPlatformInsights(metaData.platforms);
          }
        }
      }

      // Fetch Google insights if Google platform is present and synced
      if (hasGoogle && (campaign as Record<string, unknown>).googleCampaignId) {
        const googleResponse = await fetch(`/api/google/campaigns/${campaign.id}/insights`);
        const googleData = await googleResponse.json();
        if (googleData.synced && googleData.data) {
          const type = googleData.campaignType as 'DEMAND_GEN' | 'VIDEO' | undefined;
          setGoogleCampaignType(type || 'VIDEO');
          if (type === 'DEMAND_GEN') {
            setDisplayInsights(googleData.data);
          } else {
            setYoutubeInsights(googleData.data);
          }
        } else if (googleData.message) {
          setInsightsError(googleData.message);
        }
      }
    } catch (error) {
      setInsightsError('Failed to fetch campaign metrics');
      console.error('Error fetching insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  }, [isSynced, hasMeta, hasGoogle, campaign.id, campaign.metaCampaignId, startDate, endDate]);

  // Fetch insights on mount if campaign is synced
  useEffect(() => {
    if (isSynced) {
      fetchInsights();
    }
  }, [isSynced, fetchInsights]);

  const getEffectiveStatus = (): CampaignStatus => {
    if (campaign.endDate && new Date(campaign.endDate) < new Date()
        && ['PENDING', 'ACTIVE'].includes(campaign.status)) {
      return 'FINISHED';
    }
    return campaign.status as CampaignStatus;
  };

  const effectiveStatus = getEffectiveStatus();
  const googleSynced = !!(campaign as Record<string, unknown>).googleCampaignId;

  const getStatusColor = (status: CampaignStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'success' as const;
      case 'PAUSED':
        return 'warning' as const;
      case 'DRAFT':
        return 'default' as const;
      case 'PENDING':
        return 'info' as const;
      case 'ERROR':
        return 'error' as const;
      case 'FINISHED':
        return 'default' as const;
      case 'ARCHIVED':
        return 'default' as const;
      default:
        return 'default' as const;
    }
  };

  const getStatusLabel = (status: CampaignStatus) => {
    switch (status) {
      case 'ACTIVE':
        return 'Active';
      case 'PAUSED':
        return 'Paused';
      case 'DRAFT':
        return 'Draft';
      case 'PENDING':
        return 'Pending';
      case 'ERROR':
        return 'Error';
      case 'FINISHED':
        return 'Finished';
      case 'ARCHIVED':
        return 'Archived';
      default:
        return status;
    }
  };

  // Build platform cards for the breakdown section
  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'facebook':
        return <FacebookIcon sx={{ color: '#1877F2' }} />;
      case 'instagram':
        return <InstagramIcon sx={{ color: '#E4405F' }} />;
      default:
        return <FacebookIcon sx={{ color: '#666' }} />;
    }
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'facebook':
        return '#1877F2';
      case 'instagram':
        return '#E4405F';
      default:
        return '#666';
    }
  };

  const hasPlatformCards = platformInsights || displayInsights || youtubeInsights;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push(`/films/${film.id}/campaigns`)}
          sx={{ mb: 2 }}
        >
          Back to campaigns
        </Button>
        <Typography variant="h3" component="h1" gutterBottom>
          {campaign.name}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {film.title} - {film.director}
        </Typography>
        <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          {hasMeta && (
            <Chip
              icon={<FacebookIcon />}
              label="Meta"
              size="small"
              sx={{ bgcolor: '#1877F2', color: 'white', '& .MuiChip-icon': { color: 'white' } }}
            />
          )}
          {hasGoogle && (
            <Chip
              icon={<GoogleIcon />}
              label="Google Ads"
              size="small"
              sx={{ bgcolor: '#4285F4', color: 'white', '& .MuiChip-icon': { color: 'white' } }}
            />
          )}
          <Chip
            label={`Operational: ${getStatusLabel(effectiveStatus)}`}
            color={getStatusColor(effectiveStatus)}
          />
          <Chip
            label={normalizeApprovalSummary(campaign.approvalSummary as ApprovalSummary | null).label}
            color={normalizeApprovalSummary(campaign.approvalSummary as ApprovalSummary | null).color}
            variant="outlined"
          />
          <Typography variant="caption" color="text.secondary">
            {new Date(campaign.startDate).toLocaleDateString('en-US')}
            {campaign.endDate && ` - ${new Date(campaign.endDate).toLocaleDateString('en-US')}`}
          </Typography>
          {!isSynced && (
            <Chip label="Not synced" variant="outlined" size="small" />
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => router.push(`/films/${film.id}/campaigns/${campaign.id}/edit`)}
          >
            Edit campaign
          </Button>
        </Box>
      </Box>

      <CampaignStatusCard
        state={explainCampaignState({
          status: campaign.status,
          googleEntityStatus: campaign.googleEntityStatus,
          approvalSummary: campaign.approvalSummary as ApprovalSummary | null,
          disapprovedAdCount: campaign.ads.filter((a) => a.approvalStatus === 'DISAPPROVED').length,
          lastSyncError: campaign.lastSyncError,
          lastSyncErrorAt: campaign.lastSyncErrorAt,
          syncedAt: campaign.syncedAt,
          endDate: campaign.endDate,
          platforms: campaign.platforms,
        })}
        onAction={(key) => {
          if (key === 'review-ads') {
            router.push(`/films/${film.id}/campaigns/${campaign.id}/ads`);
          } else if (key === 'retry-sync') {
            const url = campaign.platforms.includes('META')
              ? `/api/meta/campaigns/${campaign.id}/sync`
              : `/api/google/campaigns/${campaign.id}/sync`;
            fetch(url, { method: 'POST' }).then(() => router.refresh()).catch(() => {});
          }
        }}
      />

      <ApprovalWarningBanner
        approvalSummary={campaign.approvalSummary as ApprovalSummary | null}
        disapprovedCount={campaign.ads.filter((a) => a.approvalStatus === 'DISAPPROVED').length}
        onReviewRejected={() => router.push(`/films/${film.id}/campaigns/${campaign.id}/ads`)}
      />

      {/* Date Filter */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography variant="body2" fontWeight="medium">
              Period:
            </Typography>
            <TextField
              label="Start date"
              type="date"
              size="small"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="End date"
              type="date"
              size="small"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 150 }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Campaign Summary Stats - Resumen general */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Resumen general</Typography>
            {isSynced && (
              <Button
                size="small"
                startIcon={insightsLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                onClick={fetchInsights}
                disabled={insightsLoading}
              >
                Refresh
              </Button>
            )}
          </Box>

          {insightsError && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {insightsError}
            </Typography>
          )}

          {/* Meta Metrics */}
          {hasMeta && (
            <Box sx={{ mt: 2, borderLeft: 3, borderColor: '#1877F2', pl: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <FacebookIcon sx={{ color: '#1877F2', fontSize: 20 }} />
                <Typography variant="subtitle2" fontWeight="bold">
                  Meta Ads
                </Typography>
              </Box>
              <Grid container spacing={3}>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Budget
                  </Typography>
                  <Typography variant="h5" color="primary">
                    ${campaign.budget.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Spend
                  </Typography>
                  <Typography variant="h5">
                    {insights ? `$${insights.spend.toLocaleString()}` : '-'}
                  </Typography>
                  {insights && insights.spend > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {((insights.spend / campaign.budget) * 100).toFixed(1)}%
                    </Typography>
                  )}
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Impressions
                  </Typography>
                  <Typography variant="h5">
                    {insights ? insights.impressions.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Clicks
                  </Typography>
                  <Typography variant="h5">
                    {insights ? insights.clicks.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Conversions
                  </Typography>
                  <Typography variant="h5" color="success.main">
                    {insights ? insights.conversions.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    CTR
                  </Typography>
                  <Typography variant="h5">
                    {insights ? `${insights.ctr.toFixed(2)}%` : '-'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Google sync failed message */}
          {hasGoogle && !googleSynced && (
            <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Google Ads sync failed — ads were not created on this platform.
              </Typography>
            </Box>
          )}

          {/* Divider between platforms */}
          {hasMeta && hasGoogle && googleSynced && <Divider sx={{ my: 2 }} />}

          {/* Google Metrics - Demand Gen */}
          {hasGoogle && googleSynced && googleCampaignType === 'DEMAND_GEN' && (
            <Box sx={{ mt: 2, borderLeft: 3, borderColor: '#4285F4', pl: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <GoogleIcon sx={{ color: '#4285F4', fontSize: 20 }} />
                <Typography variant="subtitle2" fontWeight="bold">
                  Google Ads
                </Typography>
              </Box>
              <Grid container spacing={3}>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Budget
                  </Typography>
                  <Typography variant="h5" color="primary">
                    ${campaign.budget.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Spend
                  </Typography>
                  <Typography variant="h5">
                    {displayInsights ? `$${displayInsights.spend.toLocaleString()}` : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Impressions
                  </Typography>
                  <Typography variant="h5">
                    {displayInsights ? displayInsights.impressions.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Clicks
                  </Typography>
                  <Typography variant="h5">
                    {displayInsights ? displayInsights.clicks.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Conversions
                  </Typography>
                  <Typography variant="h5" color="success.main">
                    {displayInsights ? displayInsights.conversions.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    CTR
                  </Typography>
                  <Typography variant="h5">
                    {displayInsights ? `${displayInsights.ctr.toFixed(2)}%` : '-'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Divider between platforms (for YouTube legacy) */}
          {hasMeta && hasGoogle && googleSynced && googleCampaignType === 'VIDEO' && !displayInsights && <Divider sx={{ my: 2 }} />}

          {/* YouTube Video Metrics (legacy) */}
          {hasGoogle && googleSynced && googleCampaignType === 'VIDEO' && (
            <Box sx={{ mt: 2, borderLeft: 3, borderColor: '#FF0000', pl: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <YouTubeIcon sx={{ color: '#FF0000', fontSize: 20 }} />
                <Typography variant="subtitle2" fontWeight="bold">
                  YouTube Ads
                </Typography>
              </Box>
              <Grid container spacing={3}>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Budget
                  </Typography>
                  <Typography variant="h5" color="primary">
                    ${campaign.budget.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Spend
                  </Typography>
                  <Typography variant="h5">
                    {youtubeInsights ? `$${youtubeInsights.spend.toLocaleString()}` : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Video Views
                  </Typography>
                  <Typography variant="h5" color="success.main">
                    {youtubeInsights ? youtubeInsights.videoViews.toLocaleString() : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    View Rate
                  </Typography>
                  <Typography variant="h5">
                    {youtubeInsights ? `${(youtubeInsights.videoViewRate * 100).toFixed(1)}%` : '-'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Avg. CPV
                  </Typography>
                  <Typography variant="h5">
                    {youtubeInsights ? `$${youtubeInsights.averageCpv.toFixed(3)}` : '-'}
                  </Typography>
                </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  100% Viewed
                </Typography>
                <Typography variant="h5">
                  {youtubeInsights ? `${(youtubeInsights.videoQuartile100Rate * 100).toFixed(1)}%` : '-'}
                </Typography>
              </Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Resultados por plataforma */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Resultados por plataforma
          </Typography>
          {hasPlatformCards ? (
            <Grid container spacing={3} sx={{ mt: 1 }}>
              {/* Meta platform breakdown cards */}
              {platformInsights?.map((p) => (
                <Grid key={p.platform} size={{ xs: 12, sm: 6, md: 4 }}>
                  <PlatformCard
                    icon={getPlatformIcon(p.platform)}
                    label={p.platformLabel}
                    color={getPlatformColor(p.platform)}
                    metrics={[
                      { label: 'Impresiones', value: p.impressions.toLocaleString() },
                      { label: 'Clicks', value: p.clicks.toLocaleString() },
                      { label: 'Gasto', value: `$${p.spend.toFixed(2)}` },
                      { label: 'CTR', value: `${p.ctr.toFixed(2)}%` },
                      { label: 'Conversiones', value: p.conversions.toLocaleString() },
                      {
                        label: 'Costo/Conv.',
                        value: p.costPerConversion > 0
                          ? `$${p.costPerConversion.toFixed(2)}`
                          : '-',
                      },
                    ]}
                  />
                </Grid>
              ))}

              {/* Google Ads card - Demand Gen */}
              {displayInsights && (
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <PlatformCard
                    icon={<YouTubeIcon sx={{ color: '#FF0000' }} />}
                    label="Google Ads"
                    color="#FF0000"
                    metrics={[
                      { label: 'Impresiones', value: displayInsights.impressions.toLocaleString() },
                      { label: 'Clicks', value: displayInsights.clicks.toLocaleString() },
                      { label: 'Gasto', value: `$${displayInsights.spend.toFixed(2)}` },
                      { label: 'CTR', value: `${displayInsights.ctr.toFixed(2)}%` },
                      { label: 'Conversiones', value: displayInsights.conversions.toLocaleString() },
                      {
                        label: 'Costo/Conv.',
                        value: displayInsights.conversions > 0
                          ? `$${(displayInsights.spend / displayInsights.conversions).toFixed(2)}`
                          : '-',
                      },
                    ]}
                  />
                </Grid>
              )}

              {/* Google Ads card - Video */}
              {youtubeInsights && (
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <PlatformCard
                    icon={<YouTubeIcon sx={{ color: '#FF0000' }} />}
                    label="Google Ads"
                    color="#FF0000"
                    metrics={[
                      { label: 'Impresiones', value: youtubeInsights.impressions.toLocaleString() },
                      { label: 'Clicks', value: youtubeInsights.clicks.toLocaleString() },
                      { label: 'Gasto', value: `$${youtubeInsights.spend.toFixed(2)}` },
                      { label: 'CTR', value: `${youtubeInsights.ctr.toFixed(2)}%` },
                      { label: 'Views', value: youtubeInsights.videoViews.toLocaleString() },
                      { label: 'Avg. CPV', value: `$${youtubeInsights.averageCpv.toFixed(3)}` },
                    ]}
                  />
                </Grid>
              )}
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Sin datos disponibles aún
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Campaign Targeting */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Targeting
          </Typography>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 4 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Countries
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {campaign.targetCountries.map((country) => (
                  <Chip key={country} label={country} size="small" />
                ))}
              </Box>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Age Range
              </Typography>
              <Typography variant="body1">
                {campaign.targetAgeMin} - {campaign.targetAgeMax}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Genres
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {campaign.filmGenres.length > 0 ? (
                  campaign.filmGenres.map((genre) => (
                    <Chip key={genre} label={genre} size="small" variant="outlined" />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    All genres
                  </Typography>
                )}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Ads Table */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Ads ({campaign.ads.length})
            </Typography>
            {campaign.ads.length > 0 && (
              <Button
                variant="outlined"
                size="small"
                onClick={() => router.push(`/films/${film.id}/campaigns/${campaign.id}/ads`)}
              >
                Ver anuncios
              </Button>
            )}
          </Box>
          {campaign.ads.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Ad Name</TableCell>
                    <TableCell align="center">Plataforma</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell>Headlines</TableCell>
                    <TableCell align="center">Images</TableCell>
                    <TableCell align="center">Videos</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {campaign.ads.map((ad) => (
                    <TableRow key={ad.id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {ad.name}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        {ad.metaAdId && (
                          <FacebookIcon sx={{ fontSize: 18, color: '#1877F2', mr: 0.5 }} />
                        )}
                        {ad.googleAdId && (
                          <GoogleIcon sx={{ fontSize: 18, color: '#4285F4' }} />
                        )}
                        {!ad.metaAdId && !ad.googleAdId && '-'}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={getStatusLabel(ad.status as CampaignStatus)}
                          size="small"
                          color={getStatusColor(ad.status as CampaignStatus)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                          {ad.headlines[0] || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">{ad.images.length}</TableCell>
                      <TableCell align="center">{ad.videos.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
              No ads created for this campaign yet
            </Typography>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
