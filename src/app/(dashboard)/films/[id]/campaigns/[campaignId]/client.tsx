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
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

type CampaignStatus = 'DRAFT' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR';

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

export default function CampaignDetailClient({ film, campaign }: CampaignDetailClientProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Fetch insights from Meta API
  const fetchInsights = useCallback(async () => {
    if (!campaign.metaCampaignId) return;

    setInsightsLoading(true);
    setInsightsError(null);

    try {
      const response = await fetch(`/api/meta/campaigns/${campaign.id}/insights`);
      const data = await response.json();

      if (data.synced && data.data) {
        setInsights(data.data);
      } else if (data.message) {
        setInsightsError(data.message);
      }
    } catch (error) {
      setInsightsError('Failed to fetch campaign metrics');
      console.error('Error fetching insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  }, [campaign.metaCampaignId, campaign.id]);

  // Fetch insights on mount if campaign is synced
  useEffect(() => {
    if (campaign.metaCampaignId) {
      fetchInsights();
    }
  }, [campaign.metaCampaignId, fetchInsights]);

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
      case 'ARCHIVED':
        return 'Archived';
      default:
        return status;
    }
  };

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
        <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
          <Chip
            label={getStatusLabel(campaign.status as CampaignStatus)}
            color={getStatusColor(campaign.status as CampaignStatus)}
          />
          <Typography variant="caption" color="text.secondary">
            {new Date(campaign.startDate).toLocaleDateString('en-US')}
            {campaign.endDate && ` - ${new Date(campaign.endDate).toLocaleDateString('en-US')}`}
          </Typography>
          {!campaign.metaCampaignId && (
            <Chip label="Not synced to Meta" variant="outlined" size="small" />
          )}
        </Box>
      </Box>

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

      {/* Campaign Summary Stats */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Campaign Metrics</Typography>
            {campaign.metaCampaignId && (
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

          <Grid container spacing={3} sx={{ mt: 1 }}>
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
          <Typography variant="h6" gutterBottom>
            Ads ({campaign.ads.length})
          </Typography>
          {campaign.ads.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Ad Name</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell>Headlines</TableCell>
                    <TableCell align="center">Images</TableCell>
                    <TableCell align="center">Videos</TableCell>
                    <TableCell align="center">Synced</TableCell>
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
                      <TableCell align="center">
                        {ad.metaAdId ? (
                          <Chip label="Yes" size="small" color="success" />
                        ) : (
                          <Chip label="No" size="small" variant="outlined" />
                        )}
                      </TableCell>
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
