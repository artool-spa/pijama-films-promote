import CampaignsClient from './client';
import { getFilms, getAggregateStats } from '@/models/film';

// Force dynamic rendering - data comes from external Muvi API
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  const filmsData = await getFilms(1, 100); // Get all films
  const aggregateStats = await getAggregateStats();

  return (
    <CampaignsClient
      films={filmsData.films}
      aggregateStats={aggregateStats}
    />
  );
}
