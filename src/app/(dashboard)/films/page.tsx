import { redirect } from 'next/navigation';
import FilmsClient from './client';
import { getSession } from '@/lib/auth/session';
import { getPartnerRecordByPartnerId } from '@/models/partner';
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
  // The middleware already refuses a request without a valid session cookie,
  // so this is not the gate — it is how the controller learns WHICH partner is
  // asking. Without it the page had no identity to scope anything to, which is
  // how the KPI header came to report the whole platform's figures.
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Identity only: getPartnerByPartnerId would additionally load every campaign
  // the partner owns, and all that is needed here is the document id that
  // `campaign.partnerId` holds.
  const partner = await getPartnerRecordByPartnerId(session.partnerId);
  if (!partner) {
    redirect('/login');
  }

  const params = await searchParams;
  const page = Number(params.page) || 1;
  const search = params.q?.trim() || undefined;
  const sort = VALID_SORTS.includes(params.sort as FilmSortOption)
    ? (params.sort as FilmSortOption)
    : undefined;

  // NOT YET SCOPED: getFilms still returns the whole Muvi catalogue, and each
  // film still carries every partner's campaigns for it. Closing that needs the
  // partner -> films mapping, which is an open decision, so it is deliberately
  // not papered over here. The stats below are scoped; the catalogue is not.
  const filmsData = await getFilms(page, 12, { search, sort });
  const aggregateStats = await getAggregateStats(partner.id);

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
