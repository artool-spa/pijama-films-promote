'use client';

import { Suspense } from 'react';
import { Container, Box, Typography, Grid, Pagination, Card, CardContent } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import FilmCard from '@/components/FilmCard';
import type { Film } from '@/models/film';

type FilmsClientProps = {
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
  pagination: {
    currentPage: number;
    totalPages: number;
    total: number;
  };
};

function PaginationControls({ totalPages, currentPage }: { totalPages: number; currentPage: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handlePageChange = (event: React.ChangeEvent<unknown>, page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    router.push(`/films?${params.toString()}`);
  };

  if (totalPages <= 1) return null;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
      <Pagination
        count={totalPages}
        page={currentPage}
        onChange={handlePageChange}
        color="primary"
        size="large"
      />
    </Box>
  );
}

export default function FilmsClient({ films, aggregateStats, pagination }: FilmsClientProps) {
  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          My Films
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage your films and create promotions
        </Typography>
      </Box>

      {/* Aggregate Stats */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Campaign Overview
          </Typography>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
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
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Total Budget
              </Typography>
              <Typography variant="h5">
                ${aggregateStats.totalBudget.toLocaleString()}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Impressions
              </Typography>
              <Typography variant="h5" color="info.main">
                {aggregateStats.totalImpressions > 0
                  ? aggregateStats.totalImpressions.toLocaleString()
                  : '-'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Conversions
              </Typography>
              <Typography variant="h5" color="success.main">
                {aggregateStats.totalConversions > 0
                  ? aggregateStats.totalConversions.toLocaleString()
                  : '-'}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Films Grid */}
      <Grid container spacing={3}>
        {films.map((film) => (
          <Grid key={film.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <FilmCard film={film} />
          </Grid>
        ))}
      </Grid>

      {/* Pagination */}
      <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>Loading...</Box>}>
        <PaginationControls totalPages={pagination.totalPages} currentPage={pagination.currentPage} />
      </Suspense>
    </Container>
  );
}
