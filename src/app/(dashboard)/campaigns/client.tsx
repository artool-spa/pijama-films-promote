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
  Chip,
  Button,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film } from '@/models/film';

type CampaignsClientProps = {
  films: Film[];
  aggregateStats: {
    totalBudget: number;
    totalCampaigns: number;
    activeCampaigns: number;
    totalSpend: number;
    totalConversions: number;
    totalImpressions: number;
    costPerConversion: number;
  };
};

type FilmWithAggregate = {
  film: Film;
  totalBudget: number;
  campaignCount: number;
  activeCampaigns: number;
};

export default function CampaignsClient({ films, aggregateStats }: CampaignsClientProps) {
  const router = useRouter();
  // Compute default date range from all campaigns
  const allCampaigns = films.flatMap(f => f.campaigns || []);
  const defaultStart = allCampaigns.length > 0
    ? new Date(Math.min(...allCampaigns.map(c => new Date(c.startDate).getTime()))).toISOString().split('T')[0]
    : '';
  const defaultEnd = allCampaigns.length > 0 && allCampaigns.some(c => c.endDate)
    ? new Date(Math.max(...allCampaigns.filter(c => c.endDate).map(c => new Date(c.endDate!).getTime()))).toISOString().split('T')[0]
    : '';

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // Fetch live metrics from Meta/Google for all synced campaigns
  const [liveStats, setLiveStats] = useState<{
    totalImpressions: number;
    totalSpend: number;
    totalConversions: number;
  } | null>(null);

  const fetchAllInsights = useCallback(async () => {
    const syncedCampaigns = films
      .flatMap(f => (f.campaigns || []).map(c => c))
      .filter(c => c.metaCampaignId);

    if (syncedCampaigns.length === 0) return;

    let impressions = 0, spend = 0, conversions = 0;

    await Promise.all(syncedCampaigns.map(async (campaign) => {
      if (campaign.metaCampaignId) {
        try {
          const res = await fetch(`/api/meta/campaigns/${campaign.id}/insights`);
          const data = await res.json();
          if (data.data) {
            impressions += data.data.impressions || 0;
            spend += data.data.spend || 0;
            conversions += data.data.conversions || 0;
          }
        } catch { /* skip */ }
      }
    }));

    setLiveStats({ totalImpressions: impressions, totalSpend: spend, totalConversions: conversions });
  }, [films]);

  useEffect(() => {
    fetchAllInsights();
  }, [fetchAllInsights]);

  // Group campaigns by film and calculate aggregates
  const filmsWithCampaigns: FilmWithAggregate[] = films
    .filter((f) => f.campaigns && f.campaigns.length > 0)
    .map((film) => {
      const campaigns = film.campaigns!;
      const totalBudget = campaigns.reduce((sum, c) => sum + c.budget, 0);
      const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length;

      return {
        film,
        totalBudget,
        campaignCount: campaigns.length,
        activeCampaigns,
      };
    });

  const handleRowClick = (filmId: string) => {
    router.push(`/films/${filmId}/campaigns`);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          Results
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Detailed results of your campaigns
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

      {/* Enhanced Aggregate Stats */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Campaign Summary
          </Typography>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Campaigns
              </Typography>
              <Typography variant="h5" color="primary">
                {aggregateStats.totalCampaigns}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {aggregateStats.activeCampaigns} active
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Budget
              </Typography>
              <Typography variant="h5">
                ${aggregateStats.totalBudget.toLocaleString()}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Impressions
              </Typography>
              <Typography variant="h5" color="info.main">
                {liveStats && liveStats.totalImpressions > 0
                  ? liveStats.totalImpressions.toLocaleString()
                  : liveStats ? '0' : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Conversions
              </Typography>
              <Typography variant="h5" color="success.main">
                {liveStats && liveStats.totalConversions > 0
                  ? liveStats.totalConversions.toLocaleString()
                  : liveStats ? '0' : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Spend
              </Typography>
              <Typography variant="h5">
                {liveStats && liveStats.totalSpend > 0
                  ? `$${liveStats.totalSpend.toLocaleString()}`
                  : liveStats ? '$0' : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Cost/Conversion
              </Typography>
              <Typography variant="h5">
                {liveStats && liveStats.totalConversions > 0
                  ? `$${(liveStats.totalSpend / liveStats.totalConversions).toFixed(2)}`
                  : '-'}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Films Performance Table (Grouped Campaigns) */}
      {filmsWithCampaigns.length > 0 ? (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Campaigns by Film
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Film</TableCell>
                    <TableCell align="center">Campaigns</TableCell>
                    <TableCell align="right">Budget</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filmsWithCampaigns.map((filmData) => (
                    <TableRow
                      key={filmData.film.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => handleRowClick(filmData.film.id)}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {filmData.film.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {filmData.film.director}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={`${filmData.campaignCount} ${filmData.campaignCount === 1 ? 'campaign' : 'campaigns'}`}
                          size="small"
                          color={filmData.activeCampaigns > 0 ? 'primary' : 'default'}
                        />
                      </TableCell>
                      <TableCell align="right">${filmData.totalBudget.toLocaleString()}</TableCell>
                      <TableCell align="center">
                        {filmData.activeCampaigns > 0 ? (
                          <Chip label="Active" size="small" color="success" />
                        ) : (
                          <Chip label="Inactive" size="small" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleRowClick(filmData.film.id)}
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
        <Card sx={{ mb: 4 }}>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No campaigns yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create your first campaign to start promoting your films
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => router.push('/films')}
            >
              Browse Films
            </Button>
          </CardContent>
        </Card>
      )}
    </Container>
  );
}
