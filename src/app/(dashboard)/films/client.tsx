'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Grid,
  Pagination,
  Card,
  CardContent,
  TextField,
  MenuItem,
  InputAdornment,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { useRouter, useSearchParams } from 'next/navigation';
import FilmCard from '@/components/FilmCard';
import type { Film } from '@/models/film';

const SORT_OPTIONS = [
  { value: '', label: 'Relevance' },
  { value: 'nto', label: 'Newest first' },
  { value: 'otn', label: 'Oldest first' },
  { value: 'atoz', label: 'Title (A-Z)' },
  { value: 'ztoa', label: 'Title (Z-A)' },
];

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
  search: string;
  sort: string;
};

function FilmsFilterBar({ search, sort }: { search: string; sort: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(search);
  // Track whether the current input change came from the user (vs. props sync)
  const isUserEdit = useRef(false);

  // Keep local input in sync when the URL/search prop changes externally
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Debounce pushing the search term to the URL
  useEffect(() => {
    if (!isUserEdit.current) return;
    const handle = setTimeout(() => {
      pushParams({ q: searchInput || null, page: null });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const pushParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.push(query ? `/films?${query}` : '/films');
  };

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Search"
            placeholder="Search by title"
            size="small"
            value={searchInput}
            onChange={(e) => {
              isUserEdit.current = true;
              setSearchInput(e.target.value);
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240, flexGrow: 1 }}
          />
          <TextField
            select
            label="Sort by"
            size="small"
            value={sort}
            onChange={(e) => pushParams({ sort: e.target.value || null, page: null })}
            sx={{ minWidth: 200 }}
          >
            {SORT_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </CardContent>
    </Card>
  );
}

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

export default function FilmsClient({ films, aggregateStats, pagination, search, sort }: FilmsClientProps) {
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

      {/* Search & Sort */}
      <Suspense fallback={null}>
        <FilmsFilterBar search={search} sort={sort} />
      </Suspense>

      {/* Films Grid */}
      {films.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No films found
          </Typography>
        </Box>
      ) : (
      <Grid container spacing={3}>
        {films.map((film) => (
          <Grid key={film.id} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
            <FilmCard film={film} />
          </Grid>
        ))}
      </Grid>
      )}

      {/* Pagination */}
      <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>Loading...</Box>}>
        <PaginationControls totalPages={pagination.totalPages} currentPage={pagination.currentPage} />
      </Suspense>
    </Container>
  );
}
