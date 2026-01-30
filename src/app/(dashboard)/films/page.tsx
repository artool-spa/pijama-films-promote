import FilmsClient from './client';
import { getFilms, getAggregateStats } from '@/models/film';

// Force dynamic rendering - data comes from external Muvi API
export const dynamic = 'force-dynamic';

type SearchParams = {
  page?: string;
};

export default async function FilmsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const filmsData = await getFilms(page, 12);
  const aggregateStats = await getAggregateStats();

  return (
    <FilmsClient
      films={filmsData.films}
      aggregateStats={aggregateStats}
      pagination={{
        currentPage: filmsData.currentPage,
        totalPages: filmsData.pages,
        total: filmsData.total,
      }}
    />
  );
}
