'use client';

import { useState } from 'react';
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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
                {aggregateStats.totalImpressions > 0
                  ? aggregateStats.totalImpressions.toLocaleString()
                  : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Conversions
              </Typography>
              <Typography variant="h5" color="success.main">
                {aggregateStats.totalConversions > 0
                  ? aggregateStats.totalConversions.toLocaleString()
                  : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Spend
              </Typography>
              <Typography variant="h5">
                {aggregateStats.totalSpend > 0
                  ? `$${aggregateStats.totalSpend.toLocaleString()}`
                  : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Cost/Conversion
              </Typography>
              <Typography variant="h5">
                {aggregateStats.costPerConversion > 0
                  ? `$${aggregateStats.costPerConversion.toFixed(2)}`
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
