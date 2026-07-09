import FilmsClient from './client';
import { getFilms, getAggregateStats, type FilmSortOption } from '@/models/film';

// Force dynamic rendering - data comes from external Muvi API
export const dynamic = 'force-dynamic';

const VALID_SORTS: FilmSortOption[] = ['atoz', 'ztoa', 'otn', 'nto'];

type SearchParams = {
  page?: string;
  q?: string;
  sort?: string;
};

export default async function FilmsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = Number(params.page) || 1;
  const search = params.q?.trim() || undefined;
  const sort = VALID_SORTS.includes(params.sort as FilmSortOption)
    ? (params.sort as FilmSortOption)
    : undefined;

  const filmsData = await getFilms(page, 12, { search, sort });
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
      search={search ?? ''}
      sort={sort ?? ''}
    />
  );
}
