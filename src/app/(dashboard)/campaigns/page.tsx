import { redirect } from 'next/navigation';
import CampaignsClient from './client';
import { getSession } from '@/lib/auth/session';
import { getPartnerRecordByPartnerId } from '@/models/partner';
import { getFilms, getAggregateStats } from '@/models/film';

// Force dynamic rendering - data comes from external Muvi API
export const dynamic = 'force-dynamic';

export default async function CampaignsPage() {
  // Which partner is asking. The middleware proves a session exists; it does
  // not tell the controller whose data to render, and this page had no identity
  // at all before.
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const partner = await getPartnerRecordByPartnerId(session.partnerId);
  if (!partner) {
    redirect('/login');
  }

  // NOT YET SCOPED, and this page is the widest instance of it: `client.tsx`
  // flattens `films[].campaigns` into one table, so every partner's campaign
  // names, budgets and platform ids are still listed here under a heading that
  // says they are the viewer's own. Closing that needs the partner -> films
  // mapping, which is an open decision. Only the header figures are scoped.
  const filmsData = await getFilms(1, 100); // Get all films
  const aggregateStats = await getAggregateStats(partner.id);

  return (
    <CampaignsClient
      films={filmsData.films}
      aggregateStats={aggregateStats}
    />
  );
}
