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
  Button,
  Chip,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon, Add as AddIcon } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film, CampaignSummary } from '@/models/film';

type CampaignStatus = 'DRAFT' | 'PENDING' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'ERROR';

type FilmCampaignsClientProps = {
  film: Film;
};

export default function FilmCampaignsClient({ film }: FilmCampaignsClientProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const campaigns = film.campaigns || [];

  // Calculate aggregate stats across all campaigns
  const aggregateStats = campaigns.reduce(
    (acc, campaign) => ({
      totalBudget: acc.totalBudget + campaign.budget,
      totalCampaigns: acc.totalCampaigns + 1,
      activeCampaigns: acc.activeCampaigns + (campaign.status === 'ACTIVE' ? 1 : 0),
    }),
    { totalBudget: 0, totalCampaigns: 0, activeCampaigns: 0 }
  );

  const handleRowClick = (campaignId: string) => {
    router.push(`/films/${film.id}/campaigns/${campaignId}`);
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
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Total Budget
                </Typography>
                <Typography variant="h5" color="primary">
                  ${aggregateStats.totalBudget.toLocaleString()}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Active Campaigns
                </Typography>
                <Typography variant="h5" color="success.main">
                  {aggregateStats.activeCampaigns}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 3 }}>
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
                          label={getStatusLabel(campaign.status as CampaignStatus)}
                          size="small"
                          color={getStatusColor(campaign.status as CampaignStatus)}
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
