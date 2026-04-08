import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getCampaignById } from '@/models/campaign';
import AdsDetailClient from './client';

export default async function AdsDetailPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const film = await getFilmById(id, false);
  const campaign = await getCampaignById(campaignId);

  if (!film || !campaign) {
    notFound();
  }

  return <AdsDetailClient film={film} campaign={campaign} />;
}
