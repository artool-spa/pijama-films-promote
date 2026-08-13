import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getAdById } from '@/models/ad';
import { getCampaignById } from '@/models/campaign';
import AdEditClient from './client';

export default async function AdEditPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string; adId: string }>;
}) {
  const { id, campaignId, adId } = await params;
  const [film, campaign, ad] = await Promise.all([
    getFilmById(id, false),
    getCampaignById(campaignId),
    getAdById(adId),
  ]);

  if (!film || !campaign || !ad || ad.campaignId !== campaign.id) {
    notFound();
  }

  return <AdEditClient film={film} campaign={campaign} ad={ad} />;
}
