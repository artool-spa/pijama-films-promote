import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getPartnerByPartnerId } from '@/models/partner';
import { getDraftCampaignsByPartnerId } from '@/models/campaign';
import { getFilms } from '@/models/film';
import DraftsClient from './client';

export const dynamic = 'force-dynamic';

export default async function DraftsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const partner = await getPartnerByPartnerId(session.partnerId);
  if (!partner) {
    redirect('/login');
  }

  const drafts = await getDraftCampaignsByPartnerId(partner.id);

  // Get films to resolve filmMuviUuid to film titles
  const filmsData = await getFilms(1, 100);
  const filmMap = new Map(filmsData.films.map((f) => [f.id, f.title]));

  const draftsWithFilmNames = drafts.map((draft) => ({
    id: draft.id,
    name: draft.name,
    filmMuviUuid: draft.filmMuviUuid,
    filmTitle: filmMap.get(draft.filmMuviUuid) || 'Unknown Film',
    budget: draft.budget,
    updatedAt: draft.updatedAt.toISOString(),
  }));

  return <DraftsClient drafts={draftsWithFilmNames} />;
}
