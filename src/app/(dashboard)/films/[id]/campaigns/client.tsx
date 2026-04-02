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
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Add as AddIcon } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film, CampaignSummary } from '@/models/film';

type CampaignStatus = 'DRAFT' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR' | 'FINISHED';

type FilmCampaignsClientProps = {
  film: Film;
};

export default function FilmCampaignsClient({ film }: FilmCampaignsClientProps) {
  const router = useRouter();
  const campaigns = film.campaigns || [];

  // Pre-fill Period dates from campaign date range
  const defaultStart = campaigns.length > 0
    ? new Date(Math.min(...campaigns.map(c => new Date(c.startDate).getTime()))).toISOString().split('T')[0]
    : '';
  const defaultEnd = campaigns.length > 0 && campaigns.some(c => c.endDate)
    ? new Date(Math.max(...campaigns.filter(c => c.endDate).map(c => new Date(c.endDate!).getTime()))).toISOString().split('T')[0]
    : '';

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // Calculate aggregate stats across all campaigns
  const aggregateStats = campaigns.reduce(
    (acc, campaign) => ({
      totalBudget: acc.totalBudget + campaign.budget,
      totalCampaigns: acc.totalCampaigns + 1,
      activeCampaigns: acc.activeCampaigns + (campaign.status === 'ACTIVE' ? 1 : 0),
    }),
    { totalBudget: 0, totalCampaigns: 0, activeCampaigns: 0 }
  );

  // Fetch live metrics from Meta insights API
  const [liveStats, setLiveStats] = useState<{
    impressions: number;
    clicks: number;
    spend: number;
  } | null>(null);

  const fetchInsights = useCallback(async () => {
    const syncedCampaigns = campaigns.filter(c => c.metaCampaignId);
    if (syncedCampaigns.length === 0) return;

    let impressions = 0, clicks = 0, spend = 0;

    await Promise.all(syncedCampaigns.map(async (campaign) => {
      try {
        const res = await fetch(`/api/meta/campaigns/${campaign.id}/insights`);
        const data = await res.json();
        if (data.data) {
          impressions += data.data.impressions || 0;
          clicks += data.data.clicks || 0;
          spend += data.data.spend || 0;
        }
      } catch { /* skip */ }
    }));

    setLiveStats({ impressions, clicks, spend });
  }, [campaigns]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleRowClick = (campaignId: string) => {
    router.push(`/films/${film.id}/campaigns/${campaignId}`);
  };

  const getEffectiveStatus = (campaign: { status: string; endDate?: string | Date | null }): CampaignStatus => {
    if (campaign.endDate && new Date(campaign.endDate) < new Date()
        && ['PENDING', 'ACTIVE'].includes(campaign.status)) {
      return 'FINISHED';
    }
    return campaign.status as CampaignStatus;
  };

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

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => router.push('/films')}
          >
            Back to films
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => router.push(`/films/${film.id}/campaigns/new`)}
          >
            Create Campaign
          </Button>
        </Box>
        <Typography variant="h3" component="h1" gutterBottom>
          Campaigns: {film.title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {film.director} - {film.year}
        </Typography>
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

      {/* Aggregate Stats for this Film */}
      {campaigns.length > 0 && (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Summary ({campaigns.length} {campaigns.length === 1 ? 'campaign' : 'campaigns'})
            </Typography>
            <Grid container spacing={3} sx={{ mt: 1 }}>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Total Budget
                </Typography>
                <Typography variant="h5" color="primary">
                  ${aggregateStats.totalBudget.toLocaleString()}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Spend
                </Typography>
                <Typography variant="h5">
                  {liveStats ? `$${liveStats.spend.toLocaleString()}` : '-'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Impressions
                </Typography>
                <Typography variant="h5" color="info.main">
                  {liveStats ? liveStats.impressions.toLocaleString() : '-'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Clicks
                </Typography>
                <Typography variant="h5">
                  {liveStats ? liveStats.clicks.toLocaleString() : '-'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  CTR
                </Typography>
                <Typography variant="h5">
                  {liveStats && liveStats.impressions > 0
                    ? `${(liveStats.clicks / liveStats.impressions * 100).toFixed(2)}%`
                    : '-'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Total Ads
                </Typography>
                <Typography variant="h5">
                  {campaigns.reduce((sum, c) => sum + c.adsCount, 0)}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Campaigns Table */}
      {campaigns.length > 0 ? (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Campaigns
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Campaign</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="right">Budget</TableCell>
                    <TableCell align="center">Ads</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {campaigns.map((campaign) => (
                    <TableRow
                      key={campaign.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => handleRowClick(campaign.id)}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {campaign.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(campaign.startDate).toLocaleDateString('en-US')}
                          {campaign.endDate && ` - ${new Date(campaign.endDate).toLocaleDateString('en-US')}`}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={getStatusLabel(getEffectiveStatus(campaign))}
                          size="small"
                          color={getStatusColor(getEffectiveStatus(campaign))}
                        />
                      </TableCell>
                      <TableCell align="right">${campaign.budget.toLocaleString()}</TableCell>
                      <TableCell align="center">{campaign.adsCount}</TableCell>
                      <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleRowClick(campaign.id)}
                        >
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No campaigns for this film
              </Typography>
              <Button
                variant="contained"
                onClick={() => router.push(`/films/${film.id}/campaigns/new`)}
                sx={{ mt: 2 }}
              >
                Create First Campaign
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
