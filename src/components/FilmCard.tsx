'use client';

import {
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Typography,
  Button,
  Box,
  Chip,
} from '@mui/material';
import {
  PlayCircle as PlayCircleIcon,
  Campaign as CampaignIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import type { Film } from '@/models/film';

type FilmCardProps = {
  film: Film;
};

export default function FilmCard({ film }: FilmCardProps) {
  const router = useRouter();

  // Check if film has campaigns
  const hasCampaigns = film.campaigns && film.campaigns.length > 0;
  const campaignCount = film.campaignCount || film.campaigns?.length || 0;

  // Calculate budget from campaigns
  const totalBudget = hasCampaigns
    ? film.campaigns!.reduce((sum, c) => sum + c.budget, 0)
    : 0;

  // Count active campaigns
  const activeCampaigns = hasCampaigns
    ? film.campaigns!.filter((c) => c.status === 'ACTIVE').length
    : 0;

  const handleCreatePromotion = () => {
    router.push(`/films/${film.id}/campaigns/new`);
  };

  const handleViewStats = () => {
    router.push(`/films/${film.id}/campaigns`);
  };

  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardMedia
        component="img"
        image={film.posterUrl || `https://picsum.photos/seed/${film.id}/300/400`}
        alt={film.title}
        sx={{
          aspectRatio: '3/4',
          objectFit: 'cover',
          width: '100%',
        }}
      />
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          {film.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {film.director} - {film.year}
        </Typography>

        {hasCampaigns && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <CampaignIcon fontSize="small" color="action" />
              <Typography variant="body2">
                {campaignCount} {campaignCount === 1 ? 'campaign' : 'campaigns'}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {activeCampaigns > 0 && (
                <Chip
                  icon={<PlayCircleIcon />}
                  label={`${activeCampaigns} active`}
                  size="small"
                  color="success"
                  variant="outlined"
                />
              )}
              {totalBudget > 0 && (
                <Chip
                  label={`$${totalBudget.toLocaleString()}`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
          </Box>
        )}
      </CardContent>

      <CardActions sx={{ p: 2, pt: 0, gap: 1 }}>
        {hasCampaigns ? (
          <>
            <Button size="small" variant="outlined" sx={{ flex: 1 }} onClick={handleViewStats}>
              View Campaigns
            </Button>
            <Button size="small" variant="text" onClick={() => router.push(`/films/${film.id}/assets`)}>
              Assets
            </Button>
          </>
        ) : (
          <>
            <Button
              size="small"
              variant="contained"
              sx={{ flex: 1 }}
              onClick={handleCreatePromotion}
            >
              Create Campaign
            </Button>
            <Button size="small" variant="text" onClick={() => router.push(`/films/${film.id}/assets`)}>
              Assets
            </Button>
          </>
        )}
      </CardActions>
    </Card>
  );
}
